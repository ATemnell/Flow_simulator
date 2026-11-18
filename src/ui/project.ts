/**
 * Which files the open document is connected to, and the Open / Save / Reload operations on them.
 *
 * - The project (JSON) is overwritten on Save once it has a file (picked on Open or on the first Save).
 * - The CSV script can be linked to its own file. The project remembers the link, the CSV on disk is the
 *   source of truth, and it is watched: edits saved in Excel are reloaded automatically.
 * The JSON still embeds a copy of the script so a project file is complete on its own.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { parseDocument, serializeDocument, validateSchematic } from '../model/serialize';
import type { Schematic } from '../model/types';
import type { ScriptUnits } from '../script/units';
import { canUseHandles, ensurePermission, lastModified, openFile, readHandle, safeBase, saveFileAs, writeHandle, type FileHandle, type OpenedFile } from './files';
import { forgetProject, lastProject, linkedCsv, rememberProject, type RecentProject } from './recent';
import { useApp } from './store';

interface FilesState {
  project: FileHandle | null;
  /** Name of the project file (also set in the download fallback, where there is no handle). */
  projectName: string | null;
  csv: FileHandle | null;
  csvName: string | null;
  /** Modification time of the CSV as we last read or wrote it. */
  csvModified: number;
  /** When the CSV was last reloaded from disk because it changed there. */
  csvReloadedAt: number | null;
  /** The CSV changed on disk while the script had unsaved edits here: its new text, awaiting a decision. */
  csvConflict: string | null;
  /** The project's script lives in a CSV we are not connected to (yet). */
  csvMissing: { name: string; handle: FileHandle | null } | null;
  /** Last project from a previous session, offered for reopening. */
  recent: RecentProject | null;
}

export const useFiles = create<FilesState>(() => ({
  project: null,
  projectName: null,
  csv: null,
  csvName: null,
  csvModified: 0,
  csvReloadedAt: null,
  csvConflict: null,
  csvMissing: null,
  recent: null,
}));

const setFiles = useFiles.setState;
const app = () => useApp.getState();
const fail = (e: unknown) => app().setError((e as Error).message || String(e));

const DETACHED: Partial<FilesState> = {
  project: null,
  projectName: null,
  csv: null,
  csvName: null,
  csvModified: 0,
  csvReloadedAt: null,
  csvConflict: null,
  csvMissing: null,
  recent: null,
};

/** Load a document that is not connected to any file (New, Example). */
export function loadDetached(schematic: Schematic, script?: { text: string; units: ScriptUnits }) {
  app().load(schematic, script);
  setFiles(DETACHED);
}

/** Replace the script with the CSV file's text and treat that as its saved state. */
function takeCsv(f: OpenedFile) {
  app().reloadScript(f.text);
  setFiles({ csv: f.handle, csvName: f.name, csvModified: f.lastModified, csvConflict: null, csvMissing: null });
}

/** Connect a remembered CSV handle (asks for permission if needed; call from a click). */
export async function reconnectCsv(handle: FileHandle) {
  try {
    if (!(await ensurePermission(handle, 'read'))) return;
    takeCsv(await readHandle(handle));
  } catch (e) {
    setFiles({ csvMissing: { name: handle.name, handle: null } });
    fail(new Error(`Could not read ${handle.name}: ${(e as Error).message}. Use Locate… to find it.`));
  }
}

async function loadProjectFile(f: OpenedFile) {
  const doc = parseDocument(f.text);
  app().load(doc.schematic, doc.script);
  setFiles({ ...DETACHED, project: f.handle, projectName: f.name });
  if (!f.handle) return;
  const csv = await linkedCsv(f.handle);
  if (csv) {
    // Try right away (works while the click that opened the project still counts); otherwise offer a button.
    if (await ensurePermission(csv, 'read')) await reconnectCsv(csv);
    else setFiles({ csvMissing: { name: csv.name, handle: csv } });
  } else if (doc.script?.file) {
    setFiles({ csvMissing: { name: doc.script.file, handle: null } });
  }
  await rememberProject(f.handle, useFiles.getState().csv);
}

export async function openProject() {
  try {
    const f = await openFile('project', useFiles.getState().project);
    if (!f) return;
    try {
      await loadProjectFile(f);
    } catch (e) {
      throw new Error(`Could not open ${f.name}: ${(e as Error).message}`);
    }
  } catch (e) {
    fail(e);
  }
}

export async function reopenRecent() {
  const r = useFiles.getState().recent;
  if (!r) return;
  try {
    if (!(await ensurePermission(r.project, 'readwrite'))) return;
    await loadProjectFile(await readHandle(r.project));
  } catch (e) {
    await forgetProject(r.project);
    setFiles({ recent: null });
    fail(new Error(`Could not reopen ${r.name}: ${(e as Error).message}`));
  }
}

/** Look up the last project once at startup. */
export function useRecentProject() {
  useEffect(() => {
    if (!canUseHandles) return;
    lastProject().then((recent) => {
      if (recent && !useFiles.getState().project) setFiles({ recent });
    });
  }, []);
}

export async function saveProject(as = false) {
  const { schematic, script, units, saved } = app();
  const problems = validateSchematic(schematic);
  if (problems.length) return app().setError(`Cannot save:\n${problems.join('\n')}`);
  const files = useFiles.getState();
  try {
    // Write the linked CSV first if the script changed.
    let csvError: unknown = null;
    if (files.csv && script !== saved.script) {
      try {
        setFiles({ csvModified: await writeHandle(files.csv, 'csv', script), csvConflict: null });
      } catch (e) {
        csvError = e;
      }
    }
    const csvName = files.csv ? files.csvName : files.csvMissing?.name;
    const json = serializeDocument(schematic, { text: script, units, ...(csvName ? { file: csvName } : {}) });
    let project = files.project;
    let projectName = files.projectName;
    if (project && !as) {
      await writeHandle(project, 'project', json);
    } else {
      const res = await saveFileAs('project', projectName ?? `${safeBase(schematic.name, 'schematic')}.json`, json, project ?? files.csv);
      if (!res) return;
      project = res.handle;
      projectName = project?.name ?? projectName ?? `${safeBase(schematic.name, 'schematic')}.json`;
    }
    setFiles({ project, projectName, recent: null });
    // The JSON now holds everything; the script only counts as saved if it reached its CSV too.
    useApp.setState((st) => ({ saved: { schematic: st.schematic, units: st.units, script: csvError ? saved.script : st.script } }));
    if (project) await rememberProject(project, files.csv);
    if (csvError) fail(csvError);
  } catch (e) {
    fail(e);
  }
}

export async function openCsv() {
  const { script, saved } = app();
  if (script !== saved.script && !window.confirm('The script has unsaved changes. Replace it?')) return;
  const files = useFiles.getState();
  try {
    const f = await openFile('csv', files.csv ?? files.project);
    if (!f) return;
    if (f.handle) takeCsv(f);
    else {
      app().setScript(f.text);
      setFiles({ csvName: f.name, csvMissing: null });
    }
    if (files.project && f.handle) await rememberProject(files.project, f.handle);
  } catch (e) {
    fail(e);
  }
}

export async function saveCsv(as = false) {
  const { script, schematic } = app();
  const files = useFiles.getState();
  try {
    if (files.csv && !as) {
      setFiles({ csvModified: await writeHandle(files.csv, 'csv', script), csvConflict: null });
    } else {
      const name = files.csvName ?? files.csvMissing?.name ?? `${safeBase(schematic.name, 'script')}.csv`;
      const res = await saveFileAs('csv', name, script, files.csv ?? files.project);
      if (!res) return;
      setFiles({ csv: res.handle, csvName: res.handle?.name ?? name, csvModified: res.lastModified, csvConflict: null, csvMissing: null });
      if (files.project && res.handle) await rememberProject(files.project, res.handle);
    }
    app().markSaved('script');
  } catch (e) {
    fail(e);
  }
}

/** Stop using the CSV file; the script stays, embedded in the project. */
export async function unlinkCsv() {
  const files = useFiles.getState();
  setFiles({ csv: null, csvName: null, csvModified: 0, csvReloadedAt: null, csvConflict: null, csvMissing: null });
  if (files.project) await rememberProject(files.project, null);
}

/** Resolve a conflict: take the file's version, or keep the edits here (the next Save overwrites the file). */
export function resolveConflict(take: 'file' | 'mine') {
  const text = useFiles.getState().csvConflict;
  if (text === null) return;
  if (take === 'file') app().reloadScript(text);
  setFiles({ csvConflict: null, csvReloadedAt: take === 'file' ? Date.now() : useFiles.getState().csvReloadedAt });
}

/** Re-read the CSV now (the Reload button). */
export async function reloadCsv() {
  const { csv } = useFiles.getState();
  if (!csv) return;
  const { script, saved } = app();
  if (script !== saved.script && !window.confirm('The script has unsaved changes. Reload from the file anyway?')) return;
  try {
    if (!(await ensurePermission(csv, 'read'))) return;
    takeCsv(await readHandle(csv));
    setFiles({ csvReloadedAt: Date.now() });
  } catch (e) {
    fail(new Error(`Could not read ${csv.name}: ${(e as Error).message}`));
  }
}

const WATCH_MS = 1000;

/** Poll the linked CSV and reload it when it changes on disk (e.g. saved from Excel). */
export function useCsvWatch() {
  const csv = useFiles((s) => s.csv);
  useEffect(() => {
    if (!csv) return;
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        if ((await csv.queryPermission({ mode: 'read' })) !== 'granted') return;
        const mod = await lastModified(csv);
        const files = useFiles.getState();
        if (files.csv !== csv || mod === files.csvModified) return;
        const f = await readHandle(csv);
        const { script, saved } = app();
        if (f.text === script) setFiles({ csvModified: f.lastModified });
        else if (script === saved.script) {
          app().reloadScript(f.text);
          setFiles({ csvModified: f.lastModified, csvReloadedAt: Date.now(), csvConflict: null });
        } else setFiles({ csvModified: f.lastModified, csvConflict: f.text });
      } catch {
        // The file may be mid-write or briefly locked; try again on the next tick.
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(tick, WATCH_MS);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', tick);
    };
  }, [csv]);
}

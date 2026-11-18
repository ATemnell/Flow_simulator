/**
 * Remembers recently used project files, and which CSV each project is linked to, in this browser's
 * IndexedDB. Only file *handles* are stored (permission tokens, not contents); they never leave the
 * computer and the browser asks again before the files can be read in a new session.
 */
import type { FileHandle } from './files';

export interface RecentProject {
  project: FileHandle;
  csv: FileHandle | null;
  name: string;
  at: number;
}

const DB = 'flow-cell';
const STORE = 'recent';
const KEY = 'projects';
const LIMIT = 20;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readAll(): Promise<RecentProject[]> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const req = d.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return []; // storage blocked (private window etc.): just don't remember anything
  }
}

async function writeAll(list: RecentProject[]): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(list, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

async function indexOf(list: RecentProject[], project: FileHandle): Promise<number> {
  for (let i = 0; i < list.length; i++) {
    try {
      if (await list[i].project.isSameEntry(project)) return i;
    } catch {
      /* stale handle */
    }
  }
  return -1;
}

/** Record a project (and its linked CSV) as the most recently used. */
export async function rememberProject(project: FileHandle, csv: FileHandle | null): Promise<void> {
  const list = await readAll();
  const i = await indexOf(list, project);
  if (i >= 0) list.splice(i, 1);
  list.unshift({ project, csv, name: project.name, at: Date.now() });
  await writeAll(list.slice(0, LIMIT));
}

/** The CSV this project was last linked to in this browser, if any. */
export async function linkedCsv(project: FileHandle): Promise<FileHandle | null> {
  const list = await readAll();
  const i = await indexOf(list, project);
  return i >= 0 ? list[i].csv : null;
}

export async function lastProject(): Promise<RecentProject | null> {
  return (await readAll())[0] ?? null;
}

export async function forgetProject(project: FileHandle): Promise<void> {
  const list = await readAll();
  const i = await indexOf(list, project);
  if (i >= 0) {
    list.splice(i, 1);
    await writeAll(list);
  }
}

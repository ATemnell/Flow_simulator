/**
 * Browser file helpers — no server involved. Nothing read or written here ever leaves the computer.
 *
 * In Chrome/Edge the File System Access API gives us a handle to the picked file, so Save can overwrite
 * it and the CSV can be watched for changes. Other browsers fall back to download / file input.
 */

// Minimal typings for the parts of the File System Access API we use (not in TypeScript's DOM lib).
type PermissionMode = 'read' | 'readwrite';
export interface FileHandle extends FileSystemFileHandle {
  queryPermission(opts: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission(opts: { mode: PermissionMode }): Promise<PermissionState>;
}
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface PickerWindow {
  showOpenFilePicker(opts: { types?: PickerType[]; id?: string; startIn?: FileSystemHandle }): Promise<FileHandle[]>;
  showSaveFilePicker(opts: { types?: PickerType[]; id?: string; suggestedName?: string; startIn?: FileSystemHandle }): Promise<FileHandle>;
}

export const canUseHandles = typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
const picker = () => window as unknown as PickerWindow;

export type FileKind = 'project' | 'csv';
const TYPES: Record<FileKind, PickerType> = {
  project: { description: 'Flow cell project', accept: { 'application/json': ['.json'] } },
  csv: { description: 'CSV script', accept: { 'text/csv': ['.csv', '.txt'] } },
};
const ACCEPT: Record<FileKind, string> = { project: '.json,application/json', csv: '.csv,.txt,text/csv,text/plain' };
const MIME: Record<FileKind, string> = { project: 'application/json', csv: 'text/csv' };

export interface OpenedFile {
  name: string;
  text: string;
  /** Null when the browser cannot keep a handle (download fallback). */
  handle: FileHandle | null;
  lastModified: number;
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/**
 * Decode file bytes. Excel's plain "CSV" type is saved in the Windows codepage, not UTF-8,
 * so fall back to windows-1252 when the bytes are not valid UTF-8. A UTF-8 BOM is dropped.
 */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function readFile(file: File): Promise<string> {
  return decodeText(await file.arrayBuffer());
}

/** Make sure we may read (or write) a remembered handle. Must run during a click to be able to ask. */
export async function ensurePermission(handle: FileHandle, mode: PermissionMode): Promise<boolean> {
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  try {
    return (await handle.requestPermission({ mode })) === 'granted';
  } catch {
    return false; // e.g. no user gesture
  }
}

/** Read a file we hold a handle to. */
export async function readHandle(handle: FileHandle): Promise<OpenedFile> {
  const file = await handle.getFile();
  return { name: file.name, text: await readFile(file), handle, lastModified: file.lastModified };
}

/** Just the modification time, cheap enough to poll. */
export async function lastModified(handle: FileHandle): Promise<number> {
  return (await handle.getFile()).lastModified;
}

/** Ask the user for a file and read it. Null if they cancel. */
export async function openFile(kind: FileKind, startIn?: FileHandle | null): Promise<OpenedFile | null> {
  if (canUseHandles) {
    try {
      const [handle] = await picker().showOpenFilePicker({ types: [TYPES[kind]], id: kind, ...(startIn ? { startIn } : {}) });
      return await readHandle(handle);
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT[kind];
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await readFile(f), handle: null, lastModified: f.lastModified } : null);
    };
    input.click();
  });
}

/** CSVs get a UTF-8 BOM so Excel shows characters like µ correctly. */
function encode(kind: FileKind, text: string): string {
  return kind === 'csv' ? '﻿' + text : text;
}

/** Overwrite a file we hold a handle to. Returns its new modification time. */
export async function writeHandle(handle: FileHandle, kind: FileKind, text: string): Promise<number> {
  if (!(await ensurePermission(handle, 'readwrite'))) throw new Error(`No permission to write ${handle.name}.`);
  try {
    const w = await handle.createWritable();
    await w.write(encode(kind, text));
    await w.close();
  } catch (e) {
    const msg = (e as Error).message || String(e);
    throw new Error(`Could not write ${handle.name}. If it is open in Excel (or another program), close it there and save again.\n(${msg})`);
  }
  return lastModified(handle);
}

/**
 * Ask where to save, then write. Returns the new handle (null in the download fallback),
 * or undefined if the user cancelled.
 */
export async function saveFileAs(
  kind: FileKind,
  suggestedName: string,
  text: string,
  startIn?: FileHandle | null,
): Promise<{ handle: FileHandle | null; lastModified: number } | undefined> {
  if (canUseHandles) {
    let handle: FileHandle;
    try {
      handle = await picker().showSaveFilePicker({ types: [TYPES[kind]], id: kind, suggestedName, ...(startIn ? { startIn } : {}) });
    } catch (e) {
      if (isAbort(e)) return undefined;
      throw e;
    }
    return { handle, lastModified: await writeHandle(handle, kind, text) };
  }
  downloadText(suggestedName, encode(kind, text), MIME[kind]);
  return { handle: null, lastModified: Date.now() };
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A filename-safe version of a project name. */
export function safeBase(name: string, fallback: string): string {
  return name.trim().replace(/[^\w-]+/g, '_') || fallback;
}

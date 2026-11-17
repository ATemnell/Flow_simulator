import { create } from 'zustand';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { twoInletFlowCellScript } from '../examples/twoInletFlowCellScript';
import { DEFAULT_UNITS, type ScriptUnits } from '../script/units';
import { SCHEMATIC_VERSION, type ComponentKind, type PipeEnd, type Schematic, type Vec } from '../model/types';

export type Tool = { type: 'select' } | { type: 'pipe' } | { type: 'place'; kind: ComponentKind };
export type Selection = { type: 'comp'; id: string } | { type: 'pipe'; id: string } | null;

/** A pipe being drawn: starts at a port (or an open point), collects waypoints until it ends. */
export interface Draft {
  start: PipeEnd;
  waypoints: Vec[];
}

export type Mode = 'edit' | 'run';

interface AppState {
  /** Edit the schematic, or run (animate) it. Editing is disabled while running. */
  mode: Mode;
  setMode: (m: Mode) => void;
  schematic: Schematic;
  /** CSV script text and the units it is written in. */
  script: string;
  units: ScriptUnits;
  setScript: (text: string) => void;
  setUnits: (u: ScriptUnits) => void;
  /** Bumped whenever a different document is loaded (used to re-fit the view). */
  docVersion: number;
  past: Schematic[];
  future: Schematic[];
  /** Schematic at the start of an ongoing drag/draw gesture, or null. */
  gestureBase: Schematic | null;
  selection: Selection;
  tool: Tool;
  draft: Draft | null;
  error: string | null;

  /** Load a document (schematic + optional script). */
  load: (s: Schematic, script?: { text: string; units: ScriptUnits }) => void;
  /** Apply an edit as one undoable step. */
  commit: (s: Schematic) => void;
  /** Start a gesture: subsequent setLive calls are collapsed into one undo step by endGesture. */
  beginGesture: () => void;
  setLive: (s: Schematic) => void;
  endGesture: () => void;
  /** Abort a gesture, restoring the schematic from before it started. */
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  select: (sel: Selection) => void;
  setTool: (t: Tool) => void;
  setDraft: (d: Draft | null) => void;
  setError: (e: string | null) => void;

  /** The document as last saved or opened, to detect unsaved changes. */
  saved: { schematic: Schematic; script: string; units: ScriptUnits };
  /** Record that the whole document (JSON) or only the script (CSV) has been saved. */
  markSaved: (what: 'document' | 'script') => void;
}

/** Has the document changed since it was last saved or opened? Undoing back to the saved state counts as saved. */
export function isDirty(st: Pick<AppState, 'schematic' | 'script' | 'units' | 'saved'>): boolean {
  const { saved } = st;
  return (
    st.schematic !== saved.schematic ||
    st.script !== saved.script ||
    st.units.volume !== saved.units.volume ||
    st.units.flow !== saved.units.flow ||
    st.units.time !== saved.units.time
  );
}

export const emptySchematic = (): Schematic => ({ version: SCHEMATIC_VERSION, name: 'Untitled', components: [], pipes: [] });

const HISTORY_LIMIT = 200;

export const useApp = create<AppState>((set, get) => ({
  mode: 'edit',
  setMode: (mode) => {
    if (get().draft) get().cancelGesture();
    set({ mode, tool: { type: 'select' }, draft: null });
  },
  schematic: twoInletFlowCell,
  script: twoInletFlowCellScript,
  units: DEFAULT_UNITS,
  setScript: (script) => set({ script }),
  setUnits: (units) => set({ units }),
  docVersion: 0,
  past: [],
  future: [],
  gestureBase: null,
  selection: null,
  tool: { type: 'select' },
  draft: null,
  error: null,

  saved: { schematic: twoInletFlowCell, script: twoInletFlowCellScript, units: DEFAULT_UNITS },
  markSaved: (what) =>
    set((st) => ({
      saved: what === 'document' ? { schematic: st.schematic, script: st.script, units: st.units } : { ...st.saved, script: st.script },
    })),

  load: (schematic, script) =>
    set((st) => ({
      schematic,
      script: script?.text ?? '',
      units: script?.units ?? DEFAULT_UNITS,
      saved: { schematic, script: script?.text ?? '', units: script?.units ?? DEFAULT_UNITS },
      docVersion: st.docVersion + 1, past: [], future: [], gestureBase: null, selection: null, draft: null, error: null, tool: { type: 'select' }, mode: 'edit' })),

  commit: (s) => {
    const cur = get().schematic;
    if (s === cur) return;
    set((st) => ({ schematic: s, past: [...st.past, cur].slice(-HISTORY_LIMIT), future: [] }));
  },

  beginGesture: () => set((st) => ({ gestureBase: st.gestureBase ?? st.schematic })),
  setLive: (schematic) => set({ schematic }),
  endGesture: () =>
    set((st) => {
      const base = st.gestureBase;
      if (!base || base === st.schematic) return { gestureBase: null };
      return { gestureBase: null, past: [...st.past, base].slice(-HISTORY_LIMIT), future: [] };
    }),
  cancelGesture: () => set((st) => (st.gestureBase ? { schematic: st.gestureBase, gestureBase: null } : {})),

  undo: () =>
    set((st) => {
      if (st.gestureBase || !st.past.length) return {};
      const prev = st.past[st.past.length - 1];
      return { schematic: prev, past: st.past.slice(0, -1), future: [st.schematic, ...st.future], selection: keepSelection(prev, st.selection) };
    }),
  redo: () =>
    set((st) => {
      if (st.gestureBase || !st.future.length) return {};
      const next = st.future[0];
      return { schematic: next, past: [...st.past, st.schematic], future: st.future.slice(1), selection: keepSelection(next, st.selection) };
    }),

  select: (selection) => set({ selection }),
  setTool: (tool) => {
    if (get().draft) get().cancelGesture();
    set({ tool, draft: null });
  },
  setDraft: (draft) => set({ draft }),
  setError: (error) => set({ error }),
}));

/** Drop the selection if the selected item no longer exists. */
function keepSelection(s: Schematic, sel: Selection): Selection {
  if (!sel) return null;
  const exists = sel.type === 'comp' ? s.components.some((c) => c.id === sel.id) : s.pipes.some((p) => p.id === sel.id);
  return exists ? sel : null;
}

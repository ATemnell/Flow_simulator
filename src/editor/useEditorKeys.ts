import { useEffect } from 'react';
import { deleteComponent, deletePipe, rotateComponent } from '../model/edit';
import { useApp } from '../ui/store';

/** Global editor shortcuts. Ignored while typing in a form field. */
export function useEditorKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const st = useApp.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      } else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        st.redo();
      } else if (ctrl) {
        return;
      } else if (e.key === 'Escape') {
        if (st.draft || st.tool.type !== 'select') st.setTool({ type: 'select' });
        else st.select(null);
      } else if (e.key === 'Backspace' && st.draft) {
        e.preventDefault();
        st.setDraft({ ...st.draft, waypoints: st.draft.waypoints.slice(0, -2) });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selection) {
        e.preventDefault();
        const sel = st.selection;
        st.commit(sel.type === 'comp' ? deleteComponent(st.schematic, sel.id) : deletePipe(st.schematic, sel.id));
        st.select(null);
      } else if (key === 'r' && st.selection?.type === 'comp') {
        st.commit(rotateComponent(st.schematic, st.selection.id));
      } else if (key === 'v') {
        st.setTool({ type: 'select' });
      } else if (key === 'p') {
        st.setTool({ type: 'pipe' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

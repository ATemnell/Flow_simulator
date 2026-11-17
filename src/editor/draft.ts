import { addPipe } from '../model/edit';
import { useApp } from '../ui/store';

/**
 * Finish the pipe being drawn without connecting its end: the last corner becomes an open end (×).
 * With no corners yet, the draft is simply cancelled.
 */
export function finishDraftOpen() {
  const st = useApp.getState();
  const d = st.draft;
  if (!d) return;
  if (d.waypoints.length === 0) {
    st.cancelGesture();
    st.setDraft(null);
    return;
  }
  const end = d.waypoints[d.waypoints.length - 1];
  const res = addPipe(st.schematic, d.start, { free: { ...end } }, d.waypoints.slice(0, -1));
  st.setLive(res.schematic);
  st.endGesture();
  st.setDraft(null);
  st.select({ type: 'pipe', id: res.id });
}

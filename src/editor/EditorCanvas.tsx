import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { findHops } from '../model/crossings';
import { addComponent, addPipe, dragSegment, makeComponent, moveComponent, nearestSegment, portIsFree, simplifyPipe, snap, snapVec, splitPipe, GRID } from '../model/edit';
import { DEFAULT_CHANNEL, pipePoints, pipeVisualWidth, portPosition, worldBBox, worldPorts } from '../model/geometry';
import type { PortRef, Schematic, Vec } from '../model/types';
import { ComponentView } from '../render/ComponentView';
import { PipeView, pointsToPath } from '../render/PipeView';
import { theme } from '../render/theme';
import { CHEVRON_SPACING, useRun } from '../run/runStore';
import { useApp } from '../ui/store';

interface View {
  x: number;
  y: number;
  scale: number; // screen px per mm
}

/** What the pointer is over, from the pipe tool's point of view. */
type Target = { kind: 'port'; ref: PortRef; pos: Vec; dir: Vec } | { kind: 'pipe'; id: string; pos: Vec } | null;

type Gesture =
  | { mode: 'pan'; start: Vec; origin: Vec }
  | { mode: 'moveComp'; id: string; offset: Vec }
  | { mode: 'dragSeg'; pipeId: string; index: number; start: Vec };

/** Corner point for an L-shaped route a→b. 'h' = leave a horizontally. Null if already aligned. */
function orthoCorner(a: Vec, b: Vec, first: 'h' | 'v' | 'auto'): Vec | null {
  if (a.x === b.x || a.y === b.y) return null;
  const h = first === 'h' || (first === 'auto' && Math.abs(b.x - a.x) >= Math.abs(b.y - a.y));
  return h ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
}

/** Which way the first segment should leave the draft's last point. */
function leaveMode(s: Schematic, start: PortRef, waypoints: Vec[]): 'h' | 'v' | 'auto' {
  if (waypoints.length) return 'auto';
  const c = s.components.find((k) => k.id === start.comp);
  const dir = c && worldPorts(c).find((p) => p.id === start.port)?.dir;
  return dir && dir.x !== 0 ? 'h' : dir && dir.y !== 0 ? 'v' : 'auto';
}

/** Which way to leave the corner so the last segment enters the target port head-on. */
function enterMode(dir: Vec | undefined): 'h' | 'v' | 'auto' {
  return dir && dir.x !== 0 ? 'v' : dir && dir.y !== 0 ? 'h' : 'auto';
}

export function EditorCanvas() {
  const schematic = useApp((s) => s.schematic);
  const docVersion = useApp((s) => s.docVersion);
  const selection = useApp((s) => s.selection);
  const tool = useApp((s) => s.tool);
  const draft = useApp((s) => s.draft);
  const mode = useApp((s) => s.mode);
  const sim = useRun((s) => (mode === 'run' ? s.sim : null));
  useRun((s) => s.frame); // re-render every simulation frame
  const arrowPhase = useRun((s) => s.arrowPhase);
  const issueComps = new Set(sim?.solution.issues.flatMap((i) => i.components) ?? []);

  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1.6 });
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [hover, setHover] = useState<Target>(null);
  const gesture = useRef<Gesture | null>(null);

  const pipes = useMemo(
    () =>
      schematic.pipes.flatMap((p) => {
        try {
          return [{ p, pts: pipePoints(schematic, p) }];
        } catch {
          return [];
        }
      }),
    [schematic],
  );
  const hops = useMemo(() => findHops(schematic), [schematic]);

  useLayoutEffect(() => {
    const svg = svgRef.current!;
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Fit the view to the schematic whenever a different document is loaded.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    if (schematic.components.length === 0) {
      setView({ scale: 1.6, x: -width / 2 / 1.6, y: -height / 2 / 1.6 });
      return;
    }
    const boxes = schematic.components.map(worldBBox);
    const pts = pipes.flatMap((e) => e.pts);
    const pad = 40;
    const minX = Math.min(...boxes.map((b) => b.x), ...pts.map((p) => p.x)) - pad;
    const maxX = Math.max(...boxes.map((b) => b.x + b.w), ...pts.map((p) => p.x)) + pad;
    const minY = Math.min(...boxes.map((b) => b.y), ...pts.map((p) => p.y)) - pad;
    const maxY = Math.max(...boxes.map((b) => b.y + b.h), ...pts.map((p) => p.y)) + pad + 20; // labels
    const scale = Math.min(3, Math.max(0.25, Math.min(width / (maxX - minX), height / (maxY - minY))));
    setView({ scale, x: (minX + maxX) / 2 - width / 2 / scale, y: (minY + maxY) / 2 - height / 2 / scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docVersion]);

  // Clear hover/cursor state when the tool changes.
  useEffect(() => setHover(null), [tool]);

  const toWorld = (clientX: number, clientY: number): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: view.x + (clientX - r.left) / view.scale, y: view.y + (clientY - r.top) / view.scale };
  };

  /** Resolve what the pointer is over (for the pipe tool). */
  const resolveTarget = (el: Element | null, world: Vec, s: Schematic): Target => {
    const hit = el?.closest('[data-hit]');
    if (!hit) return null;
    const kind = hit.getAttribute('data-hit');
    if (kind === 'port') {
      const ref = { comp: hit.getAttribute('data-comp')!, port: hit.getAttribute('data-port')! };
      const c = s.components.find((k) => k.id === ref.comp)!;
      const wp = worldPorts(c).find((p) => p.id === ref.port)!;
      return { kind: 'port', ref, pos: wp.pos, dir: wp.dir };
    }
    if (kind === 'comp') {
      const c = s.components.find((k) => k.id === hit.getAttribute('data-id'));
      if (c?.kind === 'junction') return { kind: 'port', ref: { comp: c.id, port: 'j' }, pos: c.pos, dir: { x: 0, y: 0 } };
      return null;
    }
    if (kind === 'pipe') {
      const id = hit.getAttribute('data-id')!;
      const p = s.pipes.find((k) => k.id === id);
      if (!p) return null;
      const pts = pipePoints(s, p);
      const seg = nearestSegment(pts, world);
      const a = pts[seg.index];
      const b = pts[seg.index + 1];
      const pos = a.y === b.y ? { x: snap(seg.point.x), y: a.y } : a.x === b.x ? { x: a.x, y: snap(seg.point.y) } : seg.point;
      return { kind: 'pipe', id, pos };
    }
    return null;
  };

  /** Can the current draft end on this target? */
  const canEnd = (t: Target, s: Schematic): boolean => {
    if (!t || !draft) return false;
    if (t.kind === 'pipe') return true;
    if (t.ref.comp === draft.start.comp && t.ref.port === draft.start.port) return false;
    return portIsFree(s, t.ref);
  };

  const lastDraftPoint = (s: Schematic): Vec | null => {
    if (!draft) return null;
    return draft.waypoints.length ? draft.waypoints[draft.waypoints.length - 1] : portPosition(s, draft.start.comp, draft.start.port);
  };

  // ---------- pointer handling ----------

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const st = useApp.getState();
    const s = st.schematic;
    const world = toWorld(e.clientX, e.clientY);
    const el = e.target as Element;

    const startPan = () => {
      svgRef.current!.setPointerCapture(e.pointerId);
      gesture.current = { mode: 'pan', start: { x: e.clientX, y: e.clientY }, origin: { x: view.x, y: view.y } };
    };

    if (e.button === 1) return startPan();
    if (e.button === 2) {
      // Right click: cancel drawing / placing.
      if (st.tool.type !== 'select') st.setTool({ type: 'select' });
      return;
    }
    if (e.button !== 0) return;

    if (st.mode === 'run') {
      // Running: no editing. Click selects (for flow readouts), drag pans.
      const hit = el.closest('[data-hit]');
      const kind = hit?.getAttribute('data-hit');
      const id = hit?.getAttribute('data-id');
      st.select(kind === 'comp' && id ? { type: 'comp', id } : kind === 'pipe' && id ? { type: 'pipe', id } : null);
      return startPan();
    }

    if (st.tool.type === 'place') {
      const c = makeComponent(s, st.tool.kind, world);
      st.commit(addComponent(s, c));
      st.select({ type: 'comp', id: c.id });
      if (!e.shiftKey) st.setTool({ type: 'select' }); // Shift: keep placing
      return;
    }

    if (st.tool.type === 'pipe') {
      const t = resolveTarget(el, world, s);
      if (!st.draft) {
        if (!t) return startPan();
        if (t.kind === 'port' && !portIsFree(s, t.ref)) return;
        st.beginGesture();
        let start: PortRef;
        if (t.kind === 'pipe') {
          // Start a branch off an existing pipe: split it with a junction.
          const r = splitPipe(s, t.id, t.pos);
          st.setLive(r.schematic);
          start = { comp: r.junctionId, port: 'j' };
        } else start = t.ref;
        st.setDraft({ start, waypoints: [] });
        st.select(null);
        return;
      }
      const d = st.draft;
      const last = lastDraftPoint(s)!;
      if (t && canEnd(t, s)) {
        let cur = s;
        let end: PortRef;
        let endDir: Vec | undefined;
        if (t.kind === 'pipe') {
          const r = splitPipe(cur, t.id, t.pos);
          cur = r.schematic;
          end = { comp: r.junctionId, port: 'j' };
        } else {
          end = t.ref;
          endDir = t.dir;
        }
        const corner = orthoCorner(last, t.pos, d.waypoints.length ? enterMode(endDir) : leaveMode(cur, d.start, d.waypoints));
        const res = addPipe(cur, d.start, end, corner ? [...d.waypoints, corner] : d.waypoints);
        st.setLive(res.schematic);
        st.endGesture();
        st.setDraft(null);
        st.select({ type: 'pipe', id: res.id });
        return;
      }
      if (t && t.kind === 'port') return; // occupied port: ignore
      // Empty space: add an L-shaped pair of waypoints.
      const p = snapVec(world);
      const corner = orthoCorner(last, p, leaveMode(s, d.start, d.waypoints));
      const add = [corner, p].filter((q): q is Vec => !!q && !(q.x === last.x && q.y === last.y));
      st.setDraft({ ...d, waypoints: [...d.waypoints, ...add] });
      return;
    }

    // Select tool.
    const hit = el.closest('[data-hit]');
    const kind = hit?.getAttribute('data-hit');
    const id = hit?.getAttribute('data-id');
    if (kind === 'comp' && id) {
      const c = s.components.find((k) => k.id === id)!;
      st.select({ type: 'comp', id });
      st.beginGesture();
      svgRef.current!.setPointerCapture(e.pointerId);
      gesture.current = { mode: 'moveComp', id, offset: { x: world.x - c.pos.x, y: world.y - c.pos.y } };
      return;
    }
    if (kind === 'pipe' && id) {
      const p = s.pipes.find((k) => k.id === id)!;
      st.select({ type: 'pipe', id });
      st.beginGesture();
      svgRef.current!.setPointerCapture(e.pointerId);
      gesture.current = { mode: 'dragSeg', pipeId: id, index: nearestSegment(pipePoints(s, p), world).index, start: world };
      return;
    }
    st.select(null);
    startPan();
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const world = toWorld(e.clientX, e.clientY);
    setCursor(world);
    const g = gesture.current;
    const st = useApp.getState();
    if (!g) {
      if (st.tool.type === 'pipe') setHover(resolveTarget(e.target as Element, world, st.schematic));
      return;
    }
    if (g.mode === 'pan') {
      setView((v) => ({ ...v, x: g.origin.x - (e.clientX - g.start.x) / v.scale, y: g.origin.y - (e.clientY - g.start.y) / v.scale }));
    } else if (g.mode === 'moveComp' && st.gestureBase) {
      st.setLive(moveComponent(st.gestureBase, g.id, { x: world.x - g.offset.x, y: world.y - g.offset.y }));
    } else if (g.mode === 'dragSeg' && st.gestureBase) {
      st.setLive(dragSegment(st.gestureBase, g.pipeId, g.index, { x: world.x - g.start.x, y: world.y - g.start.y }));
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.mode === 'pan') return;
    const st = useApp.getState();
    if (g.mode === 'dragSeg') st.setLive(simplifyPipe(st.schematic, g.pipeId));
    st.endGesture();
  };

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    setView((v) => {
      const scale = Math.min(8, Math.max(0.25, v.scale * Math.exp(-e.deltaY * 0.0015)));
      const wx = v.x + sx / v.scale;
      const wy = v.y + sy / v.scale;
      return { scale, x: wx - sx / scale, y: wy - sy / scale };
    });
  };

  // ---------- previews ----------

  let draftPreview: Vec[] | null = null;
  if (draft) {
    try {
      const start = portPosition(schematic, draft.start.comp, draft.start.port);
      const pts = [start, ...draft.waypoints];
      const last = pts[pts.length - 1];
      const end = hover && canEnd(hover, schematic) ? hover : null;
      const target = end ? end.pos : cursor ? snapVec(cursor) : last;
      const mode = draft.waypoints.length && end?.kind === 'port' ? enterMode(end.dir) : leaveMode(schematic, draft.start, draft.waypoints);
      const corner = orthoCorner(last, target, mode);
      draftPreview = corner ? [...pts, corner, target] : [...pts, target];
    } catch {
      draftPreview = null;
    }
  }

  const ghost = tool.type === 'place' && cursor ? makeComponent(schematic, tool.kind, cursor) : null;
  const selComp = selection?.type === 'comp' ? schematic.components.find((c) => c.id === selection.id) : undefined;
  const selBox = selComp ? worldBBox(selComp) : null;

  const cursorClass = mode === 'run' ? 'mode-run' : tool.type === 'select' ? 'tool-select' : tool.type === 'pipe' ? 'tool-pipe' : 'tool-place';

  return (
    <svg
      ref={svgRef}
      className={`canvas ${cursorClass}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={0} r={0.6} fill={theme.grid} />
        </pattern>
      </defs>
      <g transform={`scale(${view.scale}) translate(${-view.x} ${-view.y})`}>
        <rect x={view.x - GRID} y={view.y - GRID} width={size.w / view.scale + 2 * GRID} height={size.h / view.scale + 2 * GRID} fill="url(#grid)" />
        {pipes.map(({ p, pts }) => (
          <PipeView
            key={p.id}
            id={p.id}
            points={pts}
            width_mm={p.width_mm}
            hops={hops.get(p.id)}
            selected={selection?.type === 'pipe' && selection.id === p.id}
            live={
              sim
                ? {
                    plugs: sim.liquids.pipes.get(p.id) ?? [],
                    dir: Math.sign(sim.solution.pipeFlow.get(p.id) ?? 0),
                    phase: arrowPhase.get(p.id) ?? 0,
                    spacing: CHEVRON_SPACING,
                  }
                : undefined
            }
          />
        ))}
        {schematic.components.map((c) => (
          <ComponentView
            key={c.id}
            c={c}
            live={
              sim
                ? {
                    syringe: c.kind === 'pump' ? sim.liquids.syringes.get(c.id) : undefined,
                    valveOpen: c.kind === 'valve' ? sim.inputs.valveOpen[c.id] : undefined,
                    reservoirColor: c.kind === 'reservoir' ? sim.reservoirColor.get(c.id) : undefined,
                    reservoirLiquid: c.kind === 'reservoir' ? sim.reservoirLiquid.get(c.id) : undefined,
                    chamber: c.kind === 'flowcell' ? sim.liquids.chambers.get(c.id) : undefined,
                    issue: issueComps.has(c.id),
                  }
                : undefined
            }
          />
        ))}
        {selBox && (
          <rect
            x={selBox.x - 4}
            y={selBox.y - 4}
            width={selBox.w + 8}
            height={selBox.h + 8}
            rx={4}
            fill="none"
            stroke={theme.accent}
            strokeWidth={1.5 / view.scale}
            strokeDasharray={`${4 / view.scale} ${3 / view.scale}`}
            pointerEvents="none"
          />
        )}
        {tool.type === 'pipe' && <PortMarkers schematic={schematic} hover={hover} />}
        {draftPreview && (
          <path
            d={pointsToPath(draftPreview)}
            fill="none"
            stroke={theme.accent}
            strokeOpacity={0.7}
            strokeWidth={pipeVisualWidth(DEFAULT_CHANNEL.width_mm)}
            strokeLinejoin="round"
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
        {hover?.kind === 'pipe' && tool.type === 'pipe' && <circle cx={hover.pos.x} cy={hover.pos.y} r={5} fill={theme.accent} pointerEvents="none" />}
        {ghost && (
          <g opacity={0.45} pointerEvents="none">
            <ComponentView c={ghost} ghost />
          </g>
        )}
      </g>
    </svg>
  );
}

/** Port circles shown while the pipe tool is active: free ports are connectable. */
function PortMarkers({ schematic, hover }: { schematic: Schematic; hover: Target }) {
  return (
    <g>
      {schematic.components.flatMap((c) =>
        c.kind === 'junction'
          ? []
          : worldPorts(c).map((p) => {
              const free = portIsFree(schematic, { comp: c.id, port: p.id });
              const isHover = hover?.kind === 'port' && hover.ref.comp === c.id && hover.ref.port === p.id;
              return (
                <circle
                  key={`${c.id}:${p.id}`}
                  cx={p.pos.x}
                  cy={p.pos.y}
                  r={isHover ? 6 : 4.5}
                  fill={free ? (isHover ? theme.accent : theme.channel) : theme.muted}
                  stroke={theme.accent}
                  strokeWidth={1.5}
                  opacity={free ? 1 : 0.4}
                  data-hit={free ? 'port' : undefined}
                  data-comp={c.id}
                  data-port={p.id}
                />
              );
            }),
      )}
    </g>
  );
}

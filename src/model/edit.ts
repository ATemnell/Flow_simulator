/**
 * Pure editing operations on a Schematic. Every function returns a new schematic
 * (never mutates its input), which makes undo/redo a simple snapshot stack.
 */
import { DEFAULT_CHANNEL, endPosition, localPorts, portPosition, worldPorts } from './geometry';
import { endComp, isFree, type Component, type ComponentKind, type Pipe, type PipeEnd, type PortRef, type Rotation, type Schematic, type Vec } from './types';

export const GRID = 10;

export const snap = (v: number, g = GRID) => Math.round(v / g) * g;
export const snapVec = (p: Vec, g = GRID): Vec => ({ x: snap(p.x, g), y: snap(p.y, g) });

const same = (a: Vec, b: Vec) => a.x === b.x && a.y === b.y;

/** The port of component `id` this end is attached to, or null. */
const portAt = (e: PipeEnd, id: string): string | null => (!isFree(e) && e.comp === id ? e.port : null);

const KIND_LABEL: Record<ComponentKind, string> = {
  pump: 'Pump',
  valve: 'Valve',
  flowcell: 'Flow cell',
  reservoir: 'Reservoir',
  waste: 'Waste',
  junction: 'J',
};

/** Lowest unused `${prefix}${n}` among existing ids. */
export function nextId(existing: Iterable<string>, prefix: string): string {
  const set = new Set(existing);
  for (let n = 1; ; n++) if (!set.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

function nextName(s: Schematic, kind: ComponentKind): string {
  const names = new Set(s.components.map((c) => c.name));
  const label = KIND_LABEL[kind];
  for (let n = 1; ; n++) if (!names.has(`${label} ${n}`) && !names.has(`${label}${n}`)) return kind === 'junction' ? `${label}${n}` : `${label} ${n}`;
}

const PALETTE = ['#16a34a', '#2563eb', '#dc2626', '#9333ea', '#ea580c', '#0891b2'];

/** Default flow cell chamber volume (µL). */
export const DEFAULT_FLOWCELL_VOLUME_uL = 20;

/** A new component of the given kind with sensible defaults. */
export function makeComponent(s: Schematic, kind: ComponentKind, pos: Vec): Component {
  const base = { id: nextId(s.components.map((c) => c.id), kind), name: nextName(s, kind), pos: snapVec(pos), rotation: 0 as Rotation };
  switch (kind) {
    case 'pump':
      return { ...base, kind, syringeVolume_uL: 500, initialFill_uL: 0, initialColor: '#ffffff' };
    case 'valve':
      return { ...base, kind, initialOpen: true };
    case 'flowcell':
      return { ...base, kind, inlets: 2, outlets: 1, volume_uL: DEFAULT_FLOWCELL_VOLUME_uL };
    case 'reservoir': {
      const n = s.components.filter((c) => c.kind === 'reservoir').length;
      return { ...base, kind, liquid: 'Liquid', color: PALETTE[n % PALETTE.length] };
    }
    case 'waste':
      return { ...base, kind };
    case 'junction':
      return { ...base, kind };
  }
}

export function addComponent(s: Schematic, c: Component): Schematic {
  return { ...s, components: [...s.components, c] };
}

export function updateComponent(s: Schematic, id: string, patch: Partial<Component>): Schematic {
  const old = s.components.find((c) => c.id === id);
  if (!old) return s;
  const updated = { ...old, ...patch } as Component;
  const next = { ...s, components: s.components.map((c) => (c.id === id ? updated : c)) };
  // Changing inlet/outlet counts may remove ports: pipes on them become open ends where the port was.
  const oldPorts = new Map(worldPorts(old).map((p) => [p.id, p.pos]));
  const kept = new Set(localPorts(updated).map((p) => p.id));
  const release = (e: PipeEnd): PipeEnd => {
    const port = portAt(e, id);
    return port !== null && !kept.has(port) ? { free: oldPorts.get(port)! } : e;
  };
  return { ...next, pipes: next.pipes.map((p) => ({ ...p, from: release(p.from), to: release(p.to) })) };
}

export function updatePipe(s: Schematic, id: string, patch: Partial<Pipe>): Schematic {
  return { ...s, pipes: s.pipes.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Junctions with no pipes left are removed; a junction with exactly two pipes is merged back into one pipe. */
export function removeOrphanJunctions(s: Schematic): Schematic {
  let out = s;
  for (const j of s.components) {
    if (j.kind !== 'junction') continue;
    const attached = out.pipes.filter((p) => endComp(p.from) === j.id || endComp(p.to) === j.id);
    if (attached.length === 0) out = { ...out, components: out.components.filter((c) => c.id !== j.id) };
    else if (attached.length === 2) out = mergeAtJunction(out, j.id, attached[0], attached[1]);
  }
  return out;
}

/** Join two pipes meeting at a junction into a single pipe and remove the junction. */
function mergeAtJunction(s: Schematic, jid: string, a: Pipe, b: Pipe): Schematic {
  const jpos = s.components.find((c) => c.id === jid)!.pos;
  // Orient a so it ends at the junction and b so it starts there.
  const aIn = endComp(a.to) === jid ? a : reversePipe(a);
  const bOut = endComp(b.from) === jid ? b : reversePipe(b);
  if (endComp(aIn.from) === jid || endComp(bOut.to) === jid) return s; // loop on itself — leave it alone
  const merged: Pipe = {
    id: a.id,
    from: aIn.from,
    to: bOut.to,
    waypoints: [...aIn.waypoints, jpos, ...bOut.waypoints],
    width_mm: a.width_mm,
    depth_mm: a.depth_mm,
  };
  const pipes = s.pipes.filter((p) => p.id !== a.id && p.id !== b.id);
  const next = { ...s, pipes: [...pipes, merged], components: s.components.filter((c) => c.id !== jid) };
  return simplifyPipe(next, merged.id);
}

export function reversePipe(p: Pipe): Pipe {
  return { ...p, from: p.to, to: p.from, waypoints: [...p.waypoints].reverse() };
}

/** Delete a part. Its pipes stay, with open ends where the part's ports were. */
export function deleteComponent(s: Schematic, id: string): Schematic {
  const c = s.components.find((k) => k.id === id);
  if (!c) return s;
  const ports = new Map(worldPorts(c).map((p) => [p.id, p.pos]));
  const release = (e: PipeEnd): PipeEnd => {
    const port = portAt(e, id);
    return port !== null ? { free: { ...ports.get(port)! } } : e;
  };
  const next = {
    ...s,
    components: s.components.filter((k) => k.id !== id),
    pipes: s.pipes.map((p) => ({ ...p, from: release(p.from), to: release(p.to) })),
  };
  return removeOrphanJunctions(next);
}

export function deletePipe(s: Schematic, id: string): Schematic {
  return removeOrphanJunctions({ ...s, pipes: s.pipes.filter((p) => p.id !== id) });
}

/**
 * Move a component. Pipe ends follow it; the waypoint next to a moved end is
 * shifted along so the first/last segment stays horizontal or vertical.
 */
export function moveComponent(s: Schematic, id: string, pos: Vec, rotation?: Rotation): Schematic {
  const old = s.components.find((c) => c.id === id);
  if (!old) return s;
  const oldPorts = new Map(worldPorts(old).map((p) => [p.id, p.pos]));
  const moved = { ...old, pos: snapVec(pos), rotation: rotation ?? old.rotation } as Component;
  const newPorts = new Map(worldPorts(moved).map((p) => [p.id, p.pos]));
  const components = s.components.map((c) => (c.id === id ? moved : c));
  const pipes = s.pipes.map((p) => {
    let wps = p.waypoints;
    const f = portAt(p.from, id);
    const t = portAt(p.to, id);
    if (f !== null) wps = followEnd(wps, oldPorts.get(f)!, newPorts.get(f)!, 'start');
    if (t !== null) wps = followEnd(wps, oldPorts.get(t)!, newPorts.get(t)!, 'end');
    return wps === p.waypoints ? p : { ...p, waypoints: wps };
  });
  return { ...s, components, pipes };
}

function followEnd(wps: Vec[], oldEnd: Vec, newEnd: Vec, which: 'start' | 'end'): Vec[] {
  if (wps.length === 0) return wps;
  const i = which === 'start' ? 0 : wps.length - 1;
  const w = wps[i];
  let nw = w;
  if (w.x === oldEnd.x && w.y !== oldEnd.y) nw = { x: newEnd.x, y: w.y }; // vertical segment
  else if (w.y === oldEnd.y && w.x !== oldEnd.x) nw = { x: w.x, y: newEnd.y }; // horizontal segment
  if (nw === w) return wps;
  // The neighbouring segment must stay orthogonal too: drag the next waypoint along if it was aligned.
  const out = [...wps];
  out[i] = nw;
  const j = which === 'start' ? 1 : wps.length - 2;
  if (j >= 0 && j < wps.length) {
    const n = wps[j];
    if (n.x === w.x && nw.x !== w.x) out[j] = { x: nw.x, y: n.y };
    else if (n.y === w.y && nw.y !== w.y) out[j] = { x: n.x, y: nw.y };
  }
  return out;
}

export function rotateComponent(s: Schematic, id: string): Schematic {
  const c = s.components.find((k) => k.id === id);
  if (!c || c.kind === 'junction') return s;
  return moveComponent(s, id, c.pos, ((c.rotation + 90) % 360) as Rotation);
}

/** True if this port can accept another pipe (junctions accept any number). */
export function portIsFree(s: Schematic, ref: PortRef): boolean {
  const c = s.components.find((k) => k.id === ref.comp);
  if (!c) return false;
  if (c.kind === 'junction') return true;
  return !s.pipes.some((p) => portAt(p.from, ref.comp) === ref.port || portAt(p.to, ref.comp) === ref.port);
}

/** Remove zero-length segments and collinear interior waypoints. */
export function simplifyPolyline(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (cross === 0 && dot >= 0) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}

export function simplifyPipe(s: Schematic, id: string): Schematic {
  const p = s.pipes.find((k) => k.id === id);
  if (!p) return s;
  const a = endPosition(s, p.from);
  const b = endPosition(s, p.to);
  const pts = simplifyPolyline([a, ...p.waypoints, b]);
  // Keep the endpoints even if a waypoint coincides with them.
  const inner = pts.slice(pts[0].x === a.x && pts[0].y === a.y ? 1 : 0);
  const last = inner[inner.length - 1];
  const wps = last && last.x === b.x && last.y === b.y ? inner.slice(0, -1) : inner;
  return updatePipe(s, id, { waypoints: wps });
}

export function addPipe(
  s: Schematic,
  from: PipeEnd,
  to: PipeEnd,
  waypoints: Vec[],
  { width_mm, depth_mm } = DEFAULT_CHANNEL,
): { schematic: Schematic; id: string } {
  const id = nextId(s.pipes.map((p) => p.id), 'pipe');
  const next = { ...s, pipes: [...s.pipes, { id, from, to, waypoints, width_mm, depth_mm }] };
  return { schematic: simplifyPipe(next, id), id };
}

/**
 * After an end moved from `old` to `end`: if the last segment became diagonal, add a corner so the
 * pipe stays horizontal/vertical, continuing in the direction the pipe already had.
 */
function squareEnd(wps: Vec[], other: Vec, old: Vec, end: Vec, which: 'from' | 'to'): Vec[] {
  const pts = which === 'from' ? [end, ...wps, other] : [other, ...wps, end];
  const n = pts.length;
  const prev = which === 'from' ? pts[1] : pts[n - 2];
  if (prev.x === end.x || prev.y === end.y) return wps;
  const prev2 = which === 'from' ? pts[2] : pts[n - 3];
  // Turn at a right angle to the segment before `prev`; for a straight pipe keep its old direction.
  const goHorizontal = prev2 ? prev2.x === prev.x : old.y === prev.y;
  const corner = goHorizontal ? { x: end.x, y: prev.y } : { x: prev.x, y: end.y };
  return which === 'from' ? [corner, ...wps] : [...wps, corner];
}

/** Move an open pipe end; the pipe stays horizontal/vertical. */
export function moveFreeEnd(s: Schematic, pipeId: string, which: 'from' | 'to', pos: Vec): Schematic {
  const p = s.pipes.find((k) => k.id === pipeId);
  if (!p || !isFree(p[which])) return s;
  const old = (p[which] as { free: Vec }).free;
  const np = snapVec(pos);
  const other = endPosition(s, which === 'from' ? p.to : p.from);
  let wps = followEnd(p.waypoints, old, np, which === 'from' ? 'start' : 'end');
  wps = squareEnd(wps, other, old, np, which);
  return simplifyPipe(updatePipe(s, pipeId, { [which]: { free: np }, waypoints: wps }), pipeId);
}

/** Attach a pipe end to a port. */
export function connectEnd(s: Schematic, pipeId: string, which: 'from' | 'to', ref: PortRef): Schematic {
  const p = s.pipes.find((k) => k.id === pipeId);
  if (!p) return s;
  const old = endPosition(s, p[which]);
  const target = portPosition(s, ref.comp, ref.port);
  const other = endPosition(s, which === 'from' ? p.to : p.from);
  let wps = followEnd(p.waypoints, old, target, which === 'from' ? 'start' : 'end');
  wps = squareEnd(wps, other, old, target, which);
  return simplifyPipe(updatePipe(s, pipeId, { [which]: ref, waypoints: wps }), pipeId);
}

/** Connect every open pipe end lying on (within `tol` mm of) a free port of this component. */
export function autoConnect(s: Schematic, compId: string, tol = 1): Schematic {
  const c = s.components.find((k) => k.id === compId);
  if (!c) return s;
  let out = s;
  for (const port of worldPorts(c)) {
    for (const p of out.pipes) {
      if (!portIsFree(out, { comp: compId, port: port.id })) break;
      for (const which of ['from', 'to'] as const) {
        const e = p[which];
        if (isFree(e) && Math.hypot(e.free.x - port.pos.x, e.free.y - port.pos.y) <= tol) {
          out = connectEnd(out, p.id, which, { comp: compId, port: port.id });
          break;
        }
      }
    }
  }
  return out;
}

/** Closest point on segment ab to p, and parameter t ∈ [0,1]. */
export function projectOnSegment(p: Vec, a: Vec, b: Vec): { point: Vec; t: number; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** Which segment of a polyline is closest to p. */
export function nearestSegment(pts: Vec[], p: Vec): { index: number; point: Vec; dist: number } {
  let best = { index: 0, point: pts[0], dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const r = projectOnSegment(p, pts[i], pts[i + 1]);
    if (r.dist < best.dist) best = { index: i, point: r.point, dist: r.dist };
  }
  return best;
}

/**
 * Split a pipe at a point on it, inserting a junction there (a "T").
 * The point is snapped to the grid along the segment. Returns the junction id.
 */
export function splitPipe(s: Schematic, pipeId: string, at: Vec): { schematic: Schematic; junctionId: string } {
  const p = s.pipes.find((k) => k.id === pipeId);
  if (!p) throw new Error(`Unknown pipe ${pipeId}`);
  const pts = [endPosition(s, p.from), ...p.waypoints, endPosition(s, p.to)];
  const seg = nearestSegment(pts, at);
  const a = pts[seg.index];
  const b = pts[seg.index + 1];
  // Snap along the segment's own axis only, so the point stays on the pipe.
  let point = seg.point;
  if (a.y === b.y) point = { x: snap(point.x), y: a.y };
  else if (a.x === b.x) point = { x: a.x, y: snap(point.y) };

  const j = makeComponent(s, 'junction', point);
  const junction = { ...j, pos: point };
  const before = p.waypoints.slice(0, seg.index);
  const after = p.waypoints.slice(seg.index);
  const secondId = nextId(s.pipes.map((k) => k.id), 'pipe');
  const first: Pipe = { ...p, to: { comp: junction.id, port: 'j' }, waypoints: before };
  const second: Pipe = { ...p, id: secondId, from: { comp: junction.id, port: 'j' }, waypoints: after };
  let next: Schematic = {
    ...s,
    components: [...s.components, junction],
    pipes: s.pipes.flatMap((k) => (k.id === pipeId ? [first, second] : [k])),
  };
  next = simplifyPipe(simplifyPipe(next, first.id), second.id);
  return { schematic: next, junctionId: junction.id };
}

/** Half the distance between a valve's two ports (mm). */
const VALVE_HALF_SPAN = 20;

export interface InlineSpot {
  pipeId: string;
  /** Valve centre, on the pipe. */
  pos: Vec;
  rotation: Rotation;
}

/**
 * Where a valve dropped near `at` would sit inline on a pipe: on a straight horizontal or vertical
 * segment within `reach` mm, with room for both ports (at least one grid step of pipe left each side).
 */
export function findInlineSpot(s: Schematic, at: Vec, reach = 8): InlineSpot | null {
  let best: (InlineSpot & { dist: number }) | null = null;
  for (const p of s.pipes) {
    let pts: Vec[];
    try {
      pts = [endPosition(s, p.from), ...p.waypoints, endPosition(s, p.to)];
    } catch {
      continue;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const horizontal = a.y === b.y;
      if (!horizontal && a.x !== b.x) continue;
      const r = projectOnSegment(at, a, b);
      if (r.dist > reach || (best && r.dist >= best.dist)) continue;
      const pos = horizontal ? { x: snap(r.point.x), y: a.y } : { x: a.x, y: snap(r.point.y) };
      const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
      const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      const c = horizontal ? pos.x : pos.y;
      if (c - VALVE_HALF_SPAN < lo + GRID || c + VALVE_HALF_SPAN > hi - GRID) continue;
      best = { pipeId: p.id, pos, rotation: horizontal ? 0 : 90, dist: r.dist };
    }
  }
  return best && { pipeId: best.pipeId, pos: best.pos, rotation: best.rotation };
}

/**
 * Cut a pipe where a two-port part (a valve) sits on it and connect the two halves to its ports.
 * The part must already be centred on a straight segment of the pipe and aligned with it.
 */
export function insertInline(s: Schematic, compId: string, pipeId: string): Schematic {
  const c = s.components.find((k) => k.id === compId);
  const p = s.pipes.find((k) => k.id === pipeId);
  if (!c || !p) return s;
  const pts = [endPosition(s, p.from), ...p.waypoints, endPosition(s, p.to)];
  const ports = worldPorts(c);
  if (ports.length !== 2) return s;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const onSeg = projectOnSegment(c.pos, a, b);
    if (onSeg.dist > 1e-6 || onSeg.t <= 0 || onSeg.t >= 1) continue;
    // The port nearer the segment start connects to the first half.
    const along = (v: Vec) => projectOnSegment(v, a, b).t;
    const [near, far] = along(ports[0].pos) <= along(ports[1].pos) ? ports : [ports[1], ports[0]];
    if (projectOnSegment(near.pos, a, b).dist > 1e-6 || projectOnSegment(far.pos, a, b).dist > 1e-6) return s; // not aligned
    const secondId = nextId(s.pipes.map((k) => k.id), 'pipe');
    const first: Pipe = { ...p, to: { comp: compId, port: near.id }, waypoints: p.waypoints.slice(0, i) };
    const second: Pipe = { ...p, id: secondId, from: { comp: compId, port: far.id }, waypoints: p.waypoints.slice(i) };
    const next = { ...s, pipes: s.pipes.flatMap((k) => (k.id === pipeId ? [first, second] : [k])) };
    return simplifyPipe(simplifyPipe(next, first.id), second.id);
  }
  return s;
}

/** Is a component connected to any pipe? */
export function isConnected(s: Schematic, compId: string): boolean {
  return s.pipes.some((p) => endComp(p.from) === compId || endComp(p.to) === compId);
}

/**
 * Drag segment `index` (between points index and index+1 of the full polyline) by `delta`.
 * Horizontal segments move only vertically and vice versa. A segment touching an end gets a
 * new stub waypoint so the end stays put.
 */
export function dragSegment(s: Schematic, pipeId: string, index: number, delta: Vec): Schematic {
  const p = s.pipes.find((k) => k.id === pipeId);
  if (!p) return s;
  const start = endPosition(s, p.from);
  const end = endPosition(s, p.to);
  const pts = [start, ...p.waypoints, end];
  const a = pts[index];
  const b = pts[index + 1];
  if (!a || !b) return s;
  const d = a.y === b.y ? { x: 0, y: snap(delta.y) } : a.x === b.x ? { x: snap(delta.x), y: 0 } : snapVec(delta);
  if (d.x === 0 && d.y === 0) return s;

  const wps = [...p.waypoints];
  let i = index; // index into the full polyline
  if (i === 0) {
    wps.unshift({ ...start });
    i += 1;
  }
  if (i + 1 === wps.length + 1) wps.push({ ...end });
  // Now pts[i] and pts[i+1] are both waypoints: wps[i-1] and wps[i].
  wps[i - 1] = { x: wps[i - 1].x + d.x, y: wps[i - 1].y + d.y };
  wps[i] = { x: wps[i].x + d.x, y: wps[i].y + d.y };
  return updatePipe(s, pipeId, { waypoints: wps });
}

export { same as samePoint };

/**
 * Pure editing operations on a Schematic. Every function returns a new schematic
 * (never mutates its input), which makes undo/redo a simple snapshot stack.
 */
import { localPorts, portPosition, worldPorts } from './geometry';
import type { Component, ComponentKind, Pipe, PortRef, Rotation, Schematic, Vec } from './types';

export const GRID = 10;

export const snap = (v: number, g = GRID) => Math.round(v / g) * g;
export const snapVec = (p: Vec, g = GRID): Vec => ({ x: snap(p.x, g), y: snap(p.y, g) });

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

/** A new component of the given kind with sensible defaults. */
export function makeComponent(s: Schematic, kind: ComponentKind, pos: Vec): Component {
  const base = { id: nextId(s.components.map((c) => c.id), kind), name: nextName(s, kind), pos: snapVec(pos), rotation: 0 as Rotation };
  switch (kind) {
    case 'pump':
      return { ...base, kind, syringeVolume_uL: 500, initialFill_uL: 0, initialColor: '#ffffff' };
    case 'valve':
      return { ...base, kind, initialOpen: true };
    case 'flowcell':
      return { ...base, kind, inlets: 2, outlets: 1 };
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
  const next = { ...s, components: s.components.map((c) => (c.id === id ? ({ ...c, ...patch } as Component) : c)) };
  // Changing inlet/outlet counts may remove ports that pipes are attached to.
  return removeDanglingPipes(next);
}

export function updatePipe(s: Schematic, id: string, patch: Partial<Pipe>): Schematic {
  return { ...s, pipes: s.pipes.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Drop pipes whose ports no longer exist (e.g. after reducing flow cell inlets). */
export function removeDanglingPipes(s: Schematic): Schematic {
  const ok = (r: PortRef) => {
    const c = s.components.find((k) => k.id === r.comp);
    return !!c && localPorts(c).some((p) => p.id === r.port);
  };
  const pipes = s.pipes.filter((p) => ok(p.from) && ok(p.to));
  return pipes.length === s.pipes.length ? s : removeOrphanJunctions({ ...s, pipes });
}

/** Junctions with no pipes left are removed; a junction with exactly two pipes is merged back into one pipe. */
export function removeOrphanJunctions(s: Schematic): Schematic {
  let out = s;
  for (const j of s.components) {
    if (j.kind !== 'junction') continue;
    const attached = out.pipes.filter((p) => p.from.comp === j.id || p.to.comp === j.id);
    if (attached.length === 0) out = { ...out, components: out.components.filter((c) => c.id !== j.id) };
    else if (attached.length === 2) out = mergeAtJunction(out, j.id, attached[0], attached[1]);
  }
  return out;
}

/** Join two pipes meeting at a junction into a single pipe and remove the junction. */
function mergeAtJunction(s: Schematic, jid: string, a: Pipe, b: Pipe): Schematic {
  const jpos = s.components.find((c) => c.id === jid)!.pos;
  // Orient a so it ends at the junction and b so it starts there.
  const aIn = a.to.comp === jid ? a : reversePipe(a);
  const bOut = b.from.comp === jid ? b : reversePipe(b);
  if (aIn.from.comp === jid || bOut.to.comp === jid) return s; // loop on itself — leave it alone
  const merged: Pipe = {
    id: a.id,
    from: aIn.from,
    to: bOut.to,
    waypoints: [...aIn.waypoints, jpos, ...bOut.waypoints],
    innerDiameter_mm: a.innerDiameter_mm,
  };
  const pipes = s.pipes.filter((p) => p.id !== a.id && p.id !== b.id);
  const next = { ...s, pipes: [...pipes, merged], components: s.components.filter((c) => c.id !== jid) };
  return simplifyPipe(next, merged.id);
}

export function reversePipe(p: Pipe): Pipe {
  return { ...p, from: p.to, to: p.from, waypoints: [...p.waypoints].reverse() };
}

export function deleteComponent(s: Schematic, id: string): Schematic {
  const next = {
    ...s,
    components: s.components.filter((c) => c.id !== id),
    pipes: s.pipes.filter((p) => p.from.comp !== id && p.to.comp !== id),
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
export function moveComponent(s: Schematic, id: string, pos: Vec): Schematic {
  const old = s.components.find((c) => c.id === id);
  if (!old) return s;
  const oldPorts = new Map(worldPorts(old).map((p) => [p.id, p.pos]));
  const moved = { ...old, pos: snapVec(pos) } as Component;
  const newPorts = new Map(worldPorts(moved).map((p) => [p.id, p.pos]));
  const components = s.components.map((c) => (c.id === id ? moved : c));
  const pipes = s.pipes.map((p) => {
    let wps = p.waypoints;
    if (p.from.comp === id) wps = followEnd(wps, oldPorts.get(p.from.port)!, newPorts.get(p.from.port)!, 'start');
    if (p.to.comp === id) wps = followEnd(wps, oldPorts.get(p.to.port)!, newPorts.get(p.to.port)!, 'end');
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
  const rotation = (((c.rotation + 90) % 360) as Rotation);
  // Re-attaching pipes after rotation: treat as a move of each port, then fix up.
  const rotated = { ...c, rotation } as Component;
  const before = new Map(worldPorts(c).map((p) => [p.id, p.pos]));
  const after = new Map(worldPorts(rotated).map((p) => [p.id, p.pos]));
  const pipes = s.pipes.map((p) => {
    let wps = p.waypoints;
    if (p.from.comp === id) wps = followEnd(wps, before.get(p.from.port)!, after.get(p.from.port)!, 'start');
    if (p.to.comp === id) wps = followEnd(wps, before.get(p.to.port)!, after.get(p.to.port)!, 'end');
    return wps === p.waypoints ? p : { ...p, waypoints: wps };
  });
  return { ...s, components: s.components.map((k) => (k.id === id ? rotated : k)), pipes };
}

/** True if this port can accept another pipe (junctions accept any number). */
export function portIsFree(s: Schematic, ref: PortRef): boolean {
  const c = s.components.find((k) => k.id === ref.comp);
  if (!c) return false;
  if (c.kind === 'junction') return true;
  return !s.pipes.some((p) => (p.from.comp === ref.comp && p.from.port === ref.port) || (p.to.comp === ref.comp && p.to.port === ref.port));
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
  const a = portPosition(s, p.from.comp, p.from.port);
  const b = portPosition(s, p.to.comp, p.to.port);
  const pts = simplifyPolyline([a, ...p.waypoints, b]);
  // Keep the endpoints even if a waypoint coincides with them.
  const inner = pts.slice(pts[0].x === a.x && pts[0].y === a.y ? 1 : 0);
  const last = inner[inner.length - 1];
  const wps = last && last.x === b.x && last.y === b.y ? inner.slice(0, -1) : inner;
  return updatePipe(s, id, { waypoints: wps });
}

export function addPipe(s: Schematic, from: PortRef, to: PortRef, waypoints: Vec[], innerDiameter_mm = 1): { schematic: Schematic; id: string } {
  const id = nextId(s.pipes.map((p) => p.id), 'pipe');
  const next = { ...s, pipes: [...s.pipes, { id, from, to, waypoints, innerDiameter_mm }] };
  return { schematic: simplifyPipe(next, id), id };
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
  const pts = [portPosition(s, p.from.comp, p.from.port), ...p.waypoints, portPosition(s, p.to.comp, p.to.port)];
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

/**
 * Drag segment `index` (between points index and index+1 of the full polyline) by `delta`.
 * Horizontal segments move only vertically and vice versa. A segment touching a port gets a
 * new stub waypoint so the port end stays put.
 */
export function dragSegment(s: Schematic, pipeId: string, index: number, delta: Vec): Schematic {
  const p = s.pipes.find((k) => k.id === pipeId);
  if (!p) return s;
  const start = portPosition(s, p.from.comp, p.from.port);
  const end = portPosition(s, p.to.comp, p.to.port);
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

import { isFree, type Component, type FlowCell, type Pipe, type Rotation, type Schematic, type Vec, type PipeEnd } from './types';

/** A port in component-local coordinates (before rotation). `dir` points away from the body. */
export interface LocalPort {
  id: string;
  offset: Vec;
  dir: Vec;
}

export interface WorldPort {
  id: string;
  pos: Vec;
  dir: Vec;
}

/** Pipe wall thickness on screen, each side. */
export const WALL = 1.5;

/**
 * Syringe pump drawing, in local coordinates (nozzle towards +x).
 * The plunger rod is longer than the barrel, so the thumb rest sticks out even when empty.
 */
export const SYRINGE = { barrelL: -50, barrelR: 30, nozzleR: 50, pistonW: 4, rodLength: 88, thumbW: 4 };

export function syringeLayout(fillFraction: number) {
  const f = Math.min(1, Math.max(0, fillFraction));
  const { barrelL, barrelR, pistonW, rodLength, thumbW } = SYRINGE;
  // Piston front face: at the nozzle end when empty, near the back when full.
  const piston = barrelR - f * (barrelR - barrelL - pistonW - 2);
  const thumb = piston - pistonW - rodLength; // left edge of the thumb rest
  return { piston, thumb, thumbW };
}

export const FLOWCELL_WIDTH = 120;
export const FLOWCELL_PORT_PITCH = 20;

export function flowCellHeight(fc: Pick<FlowCell, 'inlets' | 'outlets'>): number {
  return Math.max(fc.inlets, fc.outlets, 1) * FLOWCELL_PORT_PITCH + 20;
}

/** y offsets for `n` ports at FLOWCELL_PORT_PITCH spacing, centred on 0 (always on the 10 mm grid). */
function spread(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * FLOWCELL_PORT_PITCH);
}

export function localPorts(c: Component): LocalPort[] {
  switch (c.kind) {
    case 'pump':
      return [{ id: 'out', offset: { x: 50, y: 0 }, dir: { x: 1, y: 0 } }];
    case 'valve':
      return [
        { id: 'a', offset: { x: -20, y: 0 }, dir: { x: -1, y: 0 } },
        { id: 'b', offset: { x: 20, y: 0 }, dir: { x: 1, y: 0 } },
      ];
    case 'flowcell': {
      const ins = spread(c.inlets).map((y, i) => ({
        id: `in${i}`,
        offset: { x: -FLOWCELL_WIDTH / 2, y },
        dir: { x: -1, y: 0 },
      }));
      const outs = spread(c.outlets).map((y, i) => ({
        id: `out${i}`,
        offset: { x: FLOWCELL_WIDTH / 2, y },
        dir: { x: 1, y: 0 },
      }));
      return [...ins, ...outs];
    }
    case 'reservoir':
      return [{ id: 'p', offset: { x: 0, y: -30 }, dir: { x: 0, y: -1 } }];
    case 'waste':
      return [{ id: 'p', offset: { x: 0, y: -20 }, dir: { x: 0, y: -1 } }];
    case 'junction':
      return [{ id: 'j', offset: { x: 0, y: 0 }, dir: { x: 0, y: 0 } }];
  }
}

export function rotate(v: Vec, r: Rotation): Vec {
  switch (r) {
    case 0:
      return { x: v.x, y: v.y };
    case 90:
      return { x: -v.y, y: v.x };
    case 180:
      return { x: -v.x, y: -v.y };
    case 270:
      return { x: v.y, y: -v.x };
  }
}

export function worldPorts(c: Component): WorldPort[] {
  return localPorts(c).map((p) => {
    const o = rotate(p.offset, c.rotation);
    return { id: p.id, pos: { x: c.pos.x + o.x, y: c.pos.y + o.y }, dir: rotate(p.dir, c.rotation) };
  });
}

export function portPosition(s: Schematic, comp: string, port: string): Vec {
  const c = s.components.find((k) => k.id === comp);
  if (!c) throw new Error(`Unknown component '${comp}'`);
  const p = worldPorts(c).find((q) => q.id === port);
  if (!p) throw new Error(`Component '${c.name}' has no port '${port}'`);
  return p.pos;
}

/** Position of a pipe end: its port, or where an open end lies. */
export function endPosition(s: Schematic, e: PipeEnd): Vec {
  return isFree(e) ? e.free : portPosition(s, e.comp, e.port);
}

/** Full polyline of a pipe in world coordinates (end → waypoints → end). */
export function pipePoints(s: Schematic, pipe: Pipe): Vec[] {
  return [endPosition(s, pipe.from), ...pipe.waypoints, endPosition(s, pipe.to)];
}

export function polylineLength(pts: Vec[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

/** Physical pipe length in mm. */
export function pipeLength_mm(s: Schematic, pipe: Pipe): number {
  return polylineLength(pipePoints(s, pipe));
}

/** Default channel cross-section (mm). */
export const DEFAULT_CHANNEL = { width_mm: 0.3, depth_mm: 0.35 };

/** Cross-section area in mm² (the channels are rectangular). */
export function channelArea(p: Pick<Pipe, 'width_mm' | 'depth_mm'>): number {
  return p.width_mm * p.depth_mm;
}

/** Internal volume in µL (1 mm³ = 1 µL). */
export function pipeVolume_uL(s: Schematic, pipe: Pipe): number {
  return channelArea(pipe) * pipeLength_mm(s, pipe);
}

/**
 * Hydraulic conductance of a rectangular channel (relative units; viscosity cancels out).
 * Standard approximation for laminar flow: G = a³·b·(1 − 0.63·a/b) / (12·L), a ≤ b the sides.
 */
export function channelConductance(width_mm: number, depth_mm: number, length_mm: number): number {
  const a = Math.min(width_mm, depth_mm);
  const b = Math.max(width_mm, depth_mm);
  return (a * a * a * b * (1 - (0.63 * a) / b)) / (12 * length_mm);
}

/** On-screen width of the liquid channel for a given channel width (mm). */
export function pipeVisualWidth(width_mm: number): number {
  return Math.min(24, Math.max(5, 4 + width_mm * 12));
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of a component's symbol in local (unrotated) coordinates. */
export function localBBox(c: Component): Rect {
  switch (c.kind) {
    case 'pump': {
      const { thumb } = syringeLayout(c.syringeVolume_uL > 0 ? c.initialFill_uL / c.syringeVolume_uL : 0);
      const x = thumb - 2;
      return { x, y: -16, w: SYRINGE.nozzleR + 2 - x, h: 32 };
    }
    case 'valve':
      return { x: -22, y: -24, w: 44, h: 38 };
    case 'flowcell': {
      const h = flowCellHeight(c);
      return { x: -FLOWCELL_WIDTH / 2, y: -h / 2, w: FLOWCELL_WIDTH, h };
    }
    case 'reservoir':
      return { x: -26, y: -32, w: 52, h: 59 };
    case 'waste':
      return { x: -18, y: -22, w: 36, h: 42 };
    case 'junction':
      return { x: -7, y: -7, w: 14, h: 14 };
  }
}

/** Axis-aligned bounding box of a component in world coordinates. */
export function worldBBox(c: Component): Rect {
  const b = localBBox(c);
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ].map((p) => rotate(p, c.rotation));
  const xs = corners.map((p) => p.x + c.pos.x);
  const ys = corners.map((p) => p.y + c.pos.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

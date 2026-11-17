import type { Component, FlowCell, Pipe, Rotation, Schematic, Vec } from './types';

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

export const FLOWCELL_WIDTH = 120;
export const FLOWCELL_PORT_PITCH = 20;

export function flowCellHeight(fc: Pick<FlowCell, 'inlets' | 'outlets'>): number {
  return Math.max(fc.inlets, fc.outlets, 1) * FLOWCELL_PORT_PITCH + 20;
}

/** Evenly spaced y offsets for `n` ports along an edge of height `h`, centred on 0. */
function spread(n: number, h: number): number[] {
  return Array.from({ length: n }, (_, i) => -h / 2 + (h * (i + 0.5)) / n);
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
      const h = flowCellHeight(c) - 20;
      const ins = spread(c.inlets, h).map((y, i) => ({
        id: `in${i}`,
        offset: { x: -FLOWCELL_WIDTH / 2, y },
        dir: { x: -1, y: 0 },
      }));
      const outs = spread(c.outlets, h).map((y, i) => ({
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

/** Full polyline of a pipe in world coordinates (port → waypoints → port). */
export function pipePoints(s: Schematic, pipe: Pipe): Vec[] {
  return [portPosition(s, pipe.from.comp, pipe.from.port), ...pipe.waypoints, portPosition(s, pipe.to.comp, pipe.to.port)];
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

/** Internal volume in µL (1 mm³ = 1 µL). */
export function pipeVolume_uL(s: Schematic, pipe: Pipe): number {
  const r = pipe.innerDiameter_mm / 2;
  return Math.PI * r * r * pipeLength_mm(s, pipe);
}

/** On-screen width of the liquid channel for a given inner diameter. */
export function pipeVisualWidth(innerDiameter_mm: number): number {
  return Math.min(24, Math.max(5, innerDiameter_mm * 6));
}

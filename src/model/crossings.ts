import { pipePoints, pipeVisualWidth, WALL } from './geometry';
import type { Schematic, Vec } from './types';

/** A place where a pipe hops over another pipe. */
export interface Hop {
  /** Segment index in the pipe's full polyline. */
  segment: number;
  /** Distance along that segment to the crossing point. */
  at: number;
  /** Arc radius. */
  r: number;
}

function segIntersect(a: Vec, b: Vec, c: Vec, d: Vec): { t: number; u: number } | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null; // parallel or collinear: not a crossing
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null; // touching at ends is a connection, not a crossing
  return { t, u };
}

/**
 * For every crossing between two different pipes, the pipe later in the list hops
 * over the earlier one. Returns hops per pipe id, sorted along the pipe.
 */
export function findHops(s: Schematic): Map<string, Hop[]> {
  const polys = s.pipes.map((p) => {
    try {
      return { p, pts: pipePoints(s, p) };
    } catch {
      return null;
    }
  });
  const hops = new Map<string, Hop[]>();
  for (let i = 0; i < polys.length; i++) {
    const upper = polys[i];
    if (!upper) continue;
    const list: Hop[] = [];
    for (let j = 0; j < i; j++) {
      const lower = polys[j];
      if (!lower) continue;
      const r = pipeVisualWidth(lower.p.innerDiameter_mm) / 2 + pipeVisualWidth(upper.p.innerDiameter_mm) / 2 + 2 * WALL + 2;
      for (let a = 0; a < upper.pts.length - 1; a++) {
        for (let b = 0; b < lower.pts.length - 1; b++) {
          const hit = segIntersect(upper.pts[a], upper.pts[a + 1], lower.pts[b], lower.pts[b + 1]);
          if (!hit) continue;
          const len = Math.hypot(upper.pts[a + 1].x - upper.pts[a].x, upper.pts[a + 1].y - upper.pts[a].y);
          list.push({ segment: a, at: hit.t * len, r });
        }
      }
    }
    list.sort((h, k) => h.segment - k.segment || h.at - k.at);
    if (list.length) hops.set(upper.p.id, list);
  }
  return hops;
}

/** SVG path for a polyline, with semicircular bridges at the given hops. */
export function hoppedPath(pts: Vec[], hops: Hop[] = []): string {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // Horizontal segments bulge upwards, vertical ones to the right.
    const sweep = ux > 1e-9 || (Math.abs(ux) <= 1e-9 && uy > 0) ? 1 : 0;
    let cursor = 0;
    for (const h of hops.filter((k) => k.segment === i)) {
      const r = Math.min(h.r, h.at - cursor, len - h.at);
      if (r < 2) continue; // too close to a corner or a previous hop
      const s0 = h.at - r;
      const s1 = h.at + r;
      d += ` L ${a.x + ux * s0} ${a.y + uy * s0} A ${r} ${r} 0 0 ${sweep} ${a.x + ux * s1} ${a.y + uy * s1}`;
      cursor = s1;
    }
    d += ` L ${b.x} ${b.y}`;
  }
  return d;
}

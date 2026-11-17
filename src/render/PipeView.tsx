import { pipeVisualWidth } from '../model/geometry';
import type { Vec } from '../model/types';
import { theme, WALL } from './theme';

export function pointsToPath(pts: Vec[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}

/**
 * A pipe is drawn as its cross-section: two parallel walls (a wide dark stroke)
 * with the channel (a narrower light stroke) on top. Liquid is drawn into the channel later.
 */
export function PipeView({ id, points, innerDiameter_mm }: { id: string; points: Vec[]; innerDiameter_mm: number }) {
  const w = pipeVisualWidth(innerDiameter_mm);
  const d = pointsToPath(points);
  return (
    <g className="pipe" data-id={id}>
      <path d={d} fill="none" stroke={theme.wall} strokeWidth={w + 2 * WALL} strokeLinejoin="round" strokeLinecap="butt" />
      <path d={d} fill="none" stroke={theme.channel} strokeWidth={w} strokeLinejoin="round" strokeLinecap="butt" />
    </g>
  );
}

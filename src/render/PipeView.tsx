import { hoppedPath, type Hop } from '../model/crossings';
import { pipeVisualWidth, WALL } from '../model/geometry';
import type { Vec } from '../model/types';
import { theme } from './theme';

export function pointsToPath(pts: Vec[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}

interface Props {
  id: string;
  points: Vec[];
  innerDiameter_mm: number;
  hops?: Hop[];
  selected?: boolean;
}

/**
 * A pipe is drawn as its cross-section: two parallel walls (a wide dark stroke)
 * with the channel (a narrower light stroke) on top. Liquid is drawn into the channel later.
 * Where this pipe crosses an earlier one it bridges over it with a semicircular hop.
 */
export function PipeView({ id, points, innerDiameter_mm, hops, selected }: Props) {
  const w = pipeVisualWidth(innerDiameter_mm);
  const d = hoppedPath(points, hops);
  return (
    <g className="pipe">
      {selected && <path d={d} fill="none" stroke={theme.accent} strokeOpacity={0.35} strokeWidth={w + 2 * WALL + 8} strokeLinejoin="round" />}
      {hops && hops.length > 0 && <path d={d} fill="none" stroke={theme.bg} strokeWidth={w + 2 * WALL + 4} strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={theme.wall} strokeWidth={w + 2 * WALL} strokeLinejoin="round" strokeLinecap="butt" />
      <path d={d} fill="none" stroke={theme.channel} strokeWidth={w} strokeLinejoin="round" strokeLinecap="butt" />
      {/* Wide invisible stroke: makes thin pipes easy to click. */}
      <path d={pointsToPath(points)} fill="none" stroke="transparent" strokeWidth={w + 12} data-hit="pipe" data-id={id} />
      {selected &&
        points.slice(1, -1).map((p, i) => <rect key={i} x={p.x - 3} y={p.y - 3} width={6} height={6} fill={theme.channel} stroke={theme.accent} strokeWidth={1.5} pointerEvents="none" />)}
    </g>
  );
}

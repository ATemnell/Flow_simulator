import { hoppedPath, type Hop } from '../model/crossings';
import { pipeVisualWidth, WALL } from '../model/geometry';
import type { Vec } from '../model/types';
import { EMPTY } from '../sim/color';
import type { Plug } from '../sim/transport';
import { theme } from './theme';

export function pointsToPath(pts: Vec[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}

export interface PipeLive {
  /** Contents from the `from` end to the `to` end. */
  plugs: Plug[];
  /** Flow direction: 1 = from→to, -1 = to→from, 0 = still. */
  dir: number;
  /** Chevron offset along the pipe (mm). */
  phase: number;
  spacing: number;
}

interface Props {
  id: string;
  points: Vec[];
  width_mm: number;
  hops?: Hop[];
  selected?: boolean;
  live?: PipeLive;
}

/**
 * A pipe is drawn as its cross-section: two parallel walls (a wide dark stroke)
 * with the channel (a narrower light stroke) on top. Where this pipe crosses an earlier one
 * it bridges over it with a semicircular hop. During a run the channel is filled with the
 * liquid plugs, and chevrons show the flow direction.
 */
export function PipeView({ id, points, width_mm, hops, selected, live }: Props) {
  const w = pipeVisualWidth(width_mm);
  const d = hoppedPath(points, hops);
  return (
    <g className="pipe">
      {selected && <path d={d} fill="none" stroke={theme.accent} strokeOpacity={0.35} strokeWidth={w + 2 * WALL + 8} strokeLinejoin="round" />}
      {hops && hops.length > 0 && <path d={d} fill="none" stroke={theme.bg} strokeWidth={w + 2 * WALL + 4} strokeLinejoin="round" />}
      <path d={d} fill="none" stroke={theme.wall} strokeWidth={w + 2 * WALL} strokeLinejoin="round" strokeLinecap="butt" />
      <path d={d} fill="none" stroke={theme.channel} strokeWidth={w} strokeLinejoin="round" strokeLinecap="butt" />
      {live && <Liquid d={d} plugs={live.plugs} w={w} />}
      {live && live.dir !== 0 && <Chevrons points={points} w={w} dir={live.dir} phase={live.phase} spacing={live.spacing} />}
      {/* Wide invisible stroke: makes thin pipes easy to click. */}
      <path d={pointsToPath(points)} fill="none" stroke="transparent" strokeWidth={w + 12} data-hit="pipe" data-id={id} />
      {selected &&
        points.slice(1, -1).map((p, i) => <rect key={i} x={p.x - 3} y={p.y - 3} width={6} height={6} fill={theme.channel} stroke={theme.accent} strokeWidth={1.5} pointerEvents="none" />)}
    </g>
  );
}

/** Each plug is a dash of the channel path; pathLength=1 makes dash units fractions of the pipe. */
function Liquid({ d, plugs, w }: { d: string; plugs: Plug[]; w: number }) {
  const total = plugs.reduce((a, p) => a + p.vol, 0);
  if (total <= 0) return null;
  let start = 0;
  const dashes: { color: string; start: number; len: number }[] = [];
  for (const p of plugs) {
    const len = p.vol / total;
    if (p.color !== EMPTY && len > 1e-4) dashes.push({ color: p.color, start, len });
    start += len;
  }
  return (
    <g pointerEvents="none">
      {dashes.map((s, i) => (
        <path
          key={i}
          d={d}
          pathLength={1}
          fill="none"
          stroke={s.color}
          strokeWidth={w}
          strokeLinejoin="round"
          strokeLinecap="butt"
          strokeDasharray={`${s.len} 2`}
          strokeDashoffset={-s.start}
        />
      ))}
    </g>
  );
}

/** Small arrow heads spaced along the pipe, pointing (and moving) in the flow direction. */
function Chevrons({ points, w, dir, phase, spacing }: { points: Vec[]; w: number; dir: number; phase: number; spacing: number }) {
  const a = Math.max(2.2, w * 0.38); // half length
  const b = Math.max(2.4, w * 0.42); // half width
  let d = '';
  let offset = phase; // distance from the from-end to the first chevron on the current segment
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len === 0) continue;
    const ux = (q.x - p.x) / len;
    const uy = (q.y - p.y) / len;
    const fx = ux * dir; // flow direction
    const fy = uy * dir;
    for (let s = offset; s < len; s += spacing) {
      if (s < a + 1 || s > len - a - 1) continue; // keep clear of corners
      const cx = p.x + ux * s;
      const cy = p.y + uy * s;
      const tip = `${cx + fx * a} ${cy + fy * a}`;
      const l = `${cx - fx * a - fy * b} ${cy - fy * a + fx * b}`;
      const r = `${cx - fx * a + fy * b} ${cy - fy * a - fx * b}`;
      d += `M ${l} L ${tip} L ${r} `;
    }
    offset = (((offset - len) % spacing) + spacing) % spacing;
  }
  if (!d) return null;
  return (
    <g pointerEvents="none" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke="rgba(0,0,0,0.55)" strokeWidth={2.6} />
      <path d={d} stroke="#ffffff" strokeWidth={1.3} />
    </g>
  );
}

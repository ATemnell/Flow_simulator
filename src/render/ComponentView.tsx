import { FLOWCELL_WIDTH, flowCellHeight, localBBox, SYRINGE, syringeLayout, worldBBox, worldPorts } from '../model/geometry';
import type { Component, FlowCell, Pump, Reservoir } from '../model/types';
import { EMPTY } from '../sim/color';
import type { Slab } from '../sim/flowcell';
import type { Plug } from '../sim/transport';
import { theme } from './theme';

/** Live state shown during a run (overrides the schematic's starting values). */
export interface ComponentLive {
  syringe?: Plug[];
  valveOpen?: boolean;
  reservoirColor?: string;
  reservoirLiquid?: string;
  /** Flow cell chamber content, inlet side first. */
  chamber?: Slab[];
  /** Part of an unsolvable section (e.g. pump against a closed valve). */
  issue?: boolean;
}

/**
 * Draws one component. The symbol is drawn in local coordinates, then rotated; labels stay upright.
 * `data-hit`/`data-id` let the editor identify what was clicked.
 */
export function ComponentView({ c, ghost = false, live }: { c: Component; ghost?: boolean; live?: ComponentLive }) {
  const transform = `translate(${c.pos.x} ${c.pos.y}) rotate(${c.rotation})`;
  const b = localBBox(c);
  return (
    <g className={ghost ? 'component ghost' : 'component'} data-hit={ghost ? undefined : 'comp'} data-id={c.id}>
      <g transform={transform}>
        {/* Transparent hit area so the whole symbol is clickable, not just its strokes. */}
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" />
        {live?.issue && <rect x={b.x - 5} y={b.y - 5} width={b.w + 10} height={b.h + 10} rx={6} fill="var(--fc-issue-bg)" stroke="var(--fc-issue)" strokeWidth={1.5} />}
        {symbol(c, live)}
      </g>
      {c.kind !== 'junction' && <Label c={c} live={live} />}
    </g>
  );
}

function symbol(c: Component, live?: ComponentLive) {
  switch (c.kind) {
    case 'pump':
      return <PumpSymbol c={c} contents={live?.syringe} />;
    case 'valve':
      return <ValveSymbol open={live?.valveOpen ?? c.initialOpen} />;
    case 'flowcell':
      return <FlowCellSymbol c={c} chamber={live?.chamber} />;
    case 'reservoir':
      return <ReservoirSymbol c={c} color={live?.reservoirColor ?? c.color} />;
    case 'waste':
      return <WasteSymbol />;
    case 'junction':
      return <circle r={4.5} fill={theme.wall} />;
  }
}

const syringeContents = (c: Pump, contents?: Plug[]): Plug[] =>
  contents ?? (c.initialFill_uL > 0 ? [{ color: c.initialColor, vol: c.initialFill_uL }] : []);

/** Syringe: barrel with liquid (stacked from the nozzle), piston and plunger rod; nozzle at +x. */
function PumpSymbol({ c, contents }: { c: Pump; contents?: Plug[] }) {
  const { barrelL, barrelR, nozzleR, pistonW } = SYRINGE;
  const plugs = syringeContents(c, contents);
  const fill = plugs.reduce((a, p) => a + p.vol, 0);
  const cap = c.syringeVolume_uL;
  const { piston, thumb, thumbW } = syringeLayout(cap > 0 ? fill / cap : 0);
  // Liquid plugs from the nozzle end backwards to the piston.
  const usable = barrelR - 1 - piston;
  let x = barrelR - 1;
  const bands = plugs.map((p, i) => {
    const w = fill > 0 ? (p.vol / fill) * usable : 0;
    x -= w;
    return p.color === EMPTY || w <= 0 ? null : <rect key={i} x={x} y={-12.5} width={w + 0.3} height={25} fill={p.color} />;
  });
  return (
    <g>
      <rect x={barrelR} y={-3} width={nozzleR - barrelR} height={6} fill={theme.body} stroke={theme.bodyStroke} />
      <rect x={barrelL} y={-14} width={barrelR - barrelL} height={28} rx={3} fill={theme.channel} stroke={theme.bodyStroke} strokeWidth={1.5} />
      {bands}
      {/* Finger flange at the back of the barrel. */}
      <rect x={barrelL - 3} y={-18} width={3} height={36} rx={1} fill={theme.bodyStroke} />
      <rect x={piston - pistonW} y={-13} width={pistonW} height={26} fill={theme.bodyStroke} />
      <line x1={piston - pistonW} y1={0} x2={thumb + thumbW} y2={0} stroke={theme.bodyStroke} strokeWidth={3} />
      <rect x={thumb} y={-10} width={thumbW} height={20} fill={theme.bodyStroke} />
    </g>
  );
}

/** Two-way valve: bow-tie, filled when closed. */
function ValveSymbol({ open }: { open: boolean }) {
  const fill = open ? theme.valveOpen : theme.valveClosed;
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-16} stroke={theme.bodyStroke} strokeWidth={1.5} />
      <rect x={-6} y={-22} width={12} height={7} fill={theme.body} stroke={theme.bodyStroke} />
      <path d="M -20 -12 L -20 12 L 0 0 Z M 20 -12 L 20 12 L 0 0 Z" fill={fill} stroke={theme.bodyStroke} strokeWidth={1.5} strokeLinejoin="round" />
    </g>
  );
}

/**
 * Flow cell: body with an inner chamber. During a run the chamber shows the co-flowing streams as
 * bands (top to bottom = inlet order), advancing from the inlet side (left) to the outlet side.
 */
function FlowCellSymbol({ c, chamber }: { c: FlowCell; chamber?: Slab[] }) {
  const h = flowCellHeight(c);
  const w = FLOWCELL_WIDTH;
  const x0 = -w / 2 + 10;
  const y0 = -h / 2 + 8;
  const W = w - 20;
  const H = h - 16;
  const total = chamber?.reduce((a, s) => a + s.vol, 0) ?? 0;
  const rects: JSX.Element[] = [];
  if (chamber && total > 0) {
    let x = x0;
    chamber.forEach((s, i) => {
      const sw = (s.vol / total) * W;
      let y = y0;
      s.bands.forEach((b, j) => {
        const bh = b.frac * H;
        if (b.color !== EMPTY && sw > 0.05 && bh > 0.05) rects.push(<rect key={`${i}-${j}`} x={x} y={y} width={sw + 0.4} height={bh + 0.4} fill={b.color} />);
        y += bh;
      });
      x += sw;
    });
  }
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={theme.body} stroke={theme.bodyStroke} strokeWidth={1.5} />
      <clipPath id={`chamber-${c.id}`}>
        <rect x={x0} y={y0} width={W} height={H} rx={3} />
      </clipPath>
      <rect x={x0} y={y0} width={W} height={H} rx={3} fill={theme.channel} />
      <g clipPath={`url(#chamber-${c.id})`}>{rects}</g>
      <rect x={x0} y={y0} width={W} height={H} rx={3} fill="none" stroke={theme.wall} strokeWidth={1.5} />
    </g>
  );
}

/** Open beaker with a dip tube; the port is at the top of the tube. */
function ReservoirSymbol({ color }: { c: Reservoir; color: string }) {
  return (
    <g>
      <rect x={-21} y={-6} width={42} height={30} fill={color} opacity={0.85} />
      <path d="M -24 -22 L -22 25 L 22 25 L 24 -22" fill="none" stroke={theme.bodyStroke} strokeWidth={2} strokeLinejoin="round" />
      <line x1={0} y1={-30} x2={0} y2={16} stroke={theme.wall} strokeWidth={3} />
    </g>
  );
}

/** Waste: open-ended tube into a bin — like ground on a PCB. */
function WasteSymbol() {
  return (
    <g>
      <line x1={0} y1={-20} x2={0} y2={-6} stroke={theme.wall} strokeWidth={3} />
      <path d="M -16 -6 L 16 -6 L 12 18 L -12 18 Z" fill={theme.body} stroke={theme.bodyStroke} strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M -6 2 L 6 12 M 6 2 L -6 12" stroke={theme.muted} strokeWidth={1.5} />
    </g>
  );
}

type Side = 'above' | 'below' | 'left' | 'right';

/**
 * Which side of a part its label goes on, so it never overlaps the symbol or its pipes:
 * across the axis of a pump, valve or flow cell (pipes attach along the axis), and opposite
 * the port for a reservoir or waste.
 */
export function labelSide(c: Component): Side {
  const horizontal = c.rotation % 180 === 0;
  switch (c.kind) {
    case 'pump':
      return horizontal ? 'below' : 'right';
    case 'valve':
    case 'flowcell':
      return horizontal ? 'above' : 'right';
    case 'reservoir':
    case 'waste': {
      const d = worldPorts(c)[0].dir;
      return d.y < 0 ? 'below' : d.y > 0 ? 'above' : d.x < 0 ? 'right' : 'left';
    }
    case 'junction':
      return 'below';
  }
}

function Label({ c, live }: { c: Component; live?: ComponentLive }) {
  let sub: string | undefined;
  if (c.kind === 'pump') {
    if (live?.syringe) {
      const fill = live.syringe.reduce((a, p) => a + p.vol, 0);
      sub = `${fill.toFixed(fill < 10 ? 1 : 0)} / ${c.syringeVolume_uL} µL`;
    } else sub = `${c.syringeVolume_uL} µL syringe`;
  } else if (c.kind === 'reservoir') sub = live?.reservoirLiquid ?? c.liquid;

  // A vertical pump's plunger moves along its axis; use the barrel (not the plunger) to place the label.
  const b = c.kind === 'pump' ? { ...worldBBox(c), ...barrelBox(c) } : worldBBox(c);
  const gap = 8;
  const lines = sub ? 2 : 1;
  const side = labelSide(c);
  let x = b.x + b.w / 2;
  let y: number;
  let anchor: 'middle' | 'start' | 'end' = 'middle';
  if (side === 'below') y = b.y + b.h + gap + 9;
  else if (side === 'above') y = b.y - gap - (lines - 1) * 13;
  else {
    x = side === 'right' ? b.x + b.w + gap : b.x - gap;
    anchor = side === 'right' ? 'start' : 'end';
    y = b.y + b.h / 2 + 4 - ((lines - 1) * 13) / 2;
  }
  return (
    <text x={x} y={y} textAnchor={anchor} className="label">
      <tspan fill={theme.label} fontWeight={600}>
        {c.name}
      </tspan>
      {sub && (
        <tspan x={x} dy={13} fill={theme.muted} fontSize={10}>
          {sub}
        </tspan>
      )}
    </text>
  );
}

/** World box of a pump's barrel and flange (the part that does not move). */
function barrelBox(c: Pump): { x: number; y: number; w: number; h: number } {
  const { barrelL, nozzleR } = SYRINGE;
  const local = { x: barrelL - 3, y: -18, w: nozzleR - barrelL + 3, h: 36 };
  const vertical = c.rotation % 180 !== 0;
  const w = vertical ? local.h : local.w;
  const h = vertical ? local.w : local.h;
  // Centre of the local box, rotated.
  const cx = local.x + local.w / 2;
  const off = c.rotation === 0 ? { x: cx, y: 0 } : c.rotation === 90 ? { x: 0, y: cx } : c.rotation === 180 ? { x: -cx, y: 0 } : { x: 0, y: -cx };
  return { x: c.pos.x + off.x - w / 2, y: c.pos.y + off.y - h / 2, w, h };
}

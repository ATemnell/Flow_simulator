import { FLOWCELL_WIDTH, flowCellHeight, localBBox, SYRINGE, syringeLayout } from '../model/geometry';
import type { Component, FlowCell, Pump, Reservoir, Valve } from '../model/types';
import { theme } from './theme';

/**
 * Draws one component. The symbol is drawn in local coordinates, then rotated; labels stay upright.
 * `data-hit`/`data-id` let the editor identify what was clicked.
 */
export function ComponentView({ c, ghost = false }: { c: Component; ghost?: boolean }) {
  const transform = `translate(${c.pos.x} ${c.pos.y}) rotate(${c.rotation})`;
  const b = localBBox(c);
  return (
    <g className={ghost ? 'component ghost' : 'component'} data-hit={ghost ? undefined : 'comp'} data-id={c.id}>
      <g transform={transform}>
        {/* Transparent hit area so the whole symbol is clickable, not just its strokes. */}
        <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="transparent" />
        {symbol(c)}
      </g>
      {c.kind !== 'junction' && <Label c={c} />}
    </g>
  );
}

function symbol(c: Component) {
  switch (c.kind) {
    case 'pump':
      return <PumpSymbol c={c} />;
    case 'valve':
      return <ValveSymbol c={c} />;
    case 'flowcell':
      return <FlowCellSymbol c={c} />;
    case 'reservoir':
      return <ReservoirSymbol c={c} />;
    case 'waste':
      return <WasteSymbol />;
    case 'junction':
      return <circle r={4.5} fill={theme.wall} />;
  }
}

/** Syringe: barrel with liquid, piston and plunger rod; nozzle at +x. */
function PumpSymbol({ c }: { c: Pump }) {
  const { barrelL, barrelR, nozzleR, pistonW } = SYRINGE;
  const frac = c.syringeVolume_uL > 0 ? c.initialFill_uL / c.syringeVolume_uL : 0;
  const { piston, thumb, thumbW } = syringeLayout(frac);
  return (
    <g>
      <rect x={barrelR} y={-3} width={nozzleR - barrelR} height={6} fill={theme.body} stroke={theme.bodyStroke} />
      <rect x={barrelL} y={-14} width={barrelR - barrelL} height={28} rx={3} fill={theme.channel} stroke={theme.bodyStroke} strokeWidth={1.5} />
      {frac > 0 && <rect x={piston} y={-12.5} width={barrelR - piston - 1} height={25} fill={c.initialColor} />}
      {/* Finger flange at the back of the barrel. */}
      <rect x={barrelL - 3} y={-18} width={3} height={36} rx={1} fill={theme.bodyStroke} />
      <rect x={piston - pistonW} y={-13} width={pistonW} height={26} fill={theme.bodyStroke} />
      <line x1={piston - pistonW} y1={0} x2={thumb + thumbW} y2={0} stroke={theme.bodyStroke} strokeWidth={3} />
      <rect x={thumb} y={-10} width={thumbW} height={20} fill={theme.bodyStroke} />
    </g>
  );
}

/** Two-way valve: bow-tie, filled when closed. */
function ValveSymbol({ c }: { c: Valve }) {
  const open = c.initialOpen;
  const fill = open ? theme.valveOpen : theme.valveClosed;
  return (
    <g>
      <line x1={0} y1={0} x2={0} y2={-16} stroke={theme.bodyStroke} strokeWidth={1.5} />
      <rect x={-6} y={-22} width={12} height={7} fill={theme.body} stroke={theme.bodyStroke} />
      <path d="M -20 -12 L -20 12 L 0 0 Z M 20 -12 L 20 12 L 0 0 Z" fill={fill} stroke={theme.bodyStroke} strokeWidth={1.5} strokeLinejoin="round" />
    </g>
  );
}

function FlowCellSymbol({ c }: { c: FlowCell }) {
  const h = flowCellHeight(c);
  const w = FLOWCELL_WIDTH;
  return (
    <g>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={6} fill={theme.body} stroke={theme.bodyStroke} strokeWidth={1.5} />
      <rect x={-w / 2 + 10} y={-h / 2 + 8} width={w - 20} height={h - 16} rx={3} fill={theme.channel} stroke={theme.wall} strokeWidth={1.5} />
    </g>
  );
}

/** Open beaker with a dip tube; the port is at the top of the tube. */
function ReservoirSymbol({ c }: { c: Reservoir }) {
  return (
    <g>
      <rect x={-21} y={-6} width={42} height={30} fill={c.color} opacity={0.85} />
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

function Label({ c }: { c: Component }) {
  let dy = 0;
  let sub: string | undefined;
  switch (c.kind) {
    case 'pump':
      dy = 30;
      sub = `${c.syringeVolume_uL} µL syringe`;
      break;
    case 'valve':
      dy = c.rotation % 180 === 0 ? -28 : 0;
      break;
    case 'flowcell':
      dy = -flowCellHeight(c) / 2 - 8;
      break;
    case 'reservoir':
      dy = 40;
      sub = c.liquid;
      break;
    case 'waste':
      dy = 33;
      break;
  }
  const dx = c.kind === 'valve' && c.rotation % 180 !== 0 ? 28 : 0;
  const anchor = dx ? 'start' : 'middle';
  return (
    <text x={c.pos.x + dx} y={c.pos.y + dy} textAnchor={anchor} className="label">
      <tspan fill={theme.label} fontWeight={600}>
        {c.name}
      </tspan>
      {sub && (
        <tspan x={c.pos.x + dx} dy={13} fill={theme.muted} fontSize={10}>
          {sub}
        </tspan>
      )}
    </text>
  );
}

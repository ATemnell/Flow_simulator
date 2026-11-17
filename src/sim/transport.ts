/**
 * Liquid transport ("plug flow").
 *
 * Every pipe holds an ordered list of plugs (colour + volume) from its `from` end to its `to` end.
 * Each step, the volume that the solver says flows through a pipe leaves at its downstream end
 * and enters the component there. A component with a single incoming stream passes the colour
 * sequence through unchanged (sharp fronts through valves and bends); where streams merge they are
 * blended by volume. Syringes hold a stack of plugs, nozzle first.
 */
import { pipeVolume_uL } from '../model/geometry';
import type { Schematic } from '../model/types';
import { blend, EMPTY, similar } from './color';
import type { FlowSolution } from './solver';

export interface Plug {
  color: string;
  vol: number; // µL
}

export interface LiquidState {
  /** Per pipe, ordered from the pipe's `from` end to its `to` end. Total = pipe volume. */
  pipes: Map<string, Plug[]>;
  /** Per pump, syringe contents ordered from the nozzle inwards. Total = fill volume. */
  syringes: Map<string, Plug[]>;
}

const TINY = 1e-9;
const MAX_PLUGS = 400;

export function initialLiquids(s: Schematic): LiquidState {
  const pipes = new Map<string, Plug[]>();
  for (const p of s.pipes) {
    let v = 0;
    try {
      v = pipeVolume_uL(s, p);
    } catch {
      /* dangling */
    }
    pipes.set(p.id, [{ color: EMPTY, vol: v }]);
  }
  const syringes = new Map<string, Plug[]>();
  for (const c of s.components) if (c.kind === 'pump') syringes.set(c.id, c.initialFill_uL > 0 ? [{ color: c.initialColor, vol: c.initialFill_uL }] : []);
  return { pipes, syringes };
}

export const totalVolume = (plugs: Plug[]) => plugs.reduce((a, p) => a + p.vol, 0);

/** Remove `v` µL from the start of the list. Returns removed plugs in exit order. Pads with air if short. */
export function takeFromStart(plugs: Plug[], v: number): Plug[] {
  const out: Plug[] = [];
  while (v > TINY && plugs.length) {
    const p = plugs[0];
    if (p.vol <= v + TINY) {
      out.push(plugs.shift()!);
      v -= p.vol;
    } else {
      out.push({ color: p.color, vol: v });
      p.vol -= v;
      v = 0;
    }
  }
  if (v > TINY) out.push({ color: EMPTY, vol: v });
  return out;
}

/** Remove `v` µL from the end of the list. Returns removed plugs in exit order (last plug first). */
export function takeFromEnd(plugs: Plug[], v: number): Plug[] {
  const out: Plug[] = [];
  while (v > TINY && plugs.length) {
    const p = plugs[plugs.length - 1];
    if (p.vol <= v + TINY) {
      out.push(plugs.pop()!);
      v -= p.vol;
    } else {
      out.push({ color: p.color, vol: v });
      p.vol -= v;
      v = 0;
    }
  }
  if (v > TINY) out.push({ color: EMPTY, vol: v });
  return out;
}

/** Merge neighbours of (nearly) the same colour, drop slivers, and cap the plug count. */
export function compact(plugs: Plug[]): Plug[] {
  const out: Plug[] = [];
  for (const p of plugs) {
    if (p.vol <= TINY) continue;
    const last = out[out.length - 1];
    if (last && similar(last.color, p.color)) {
      const color = last.color === p.color ? p.color : blend([last, p]);
      out[out.length - 1] = { color, vol: last.vol + p.vol };
    } else out.push({ ...p });
  }
  while (out.length > MAX_PLUGS) {
    let best = 0;
    for (let i = 1; i < out.length - 1; i++) if (out[i].vol + out[i + 1].vol < out[best].vol + out[best + 1].vol) best = i;
    const a = out[best];
    const b = out[best + 1];
    out.splice(best, 2, { color: blend([a, b]), vol: a.vol + b.vol });
  }
  return out;
}

function scaleSeq(seq: Plug[], f: number): Plug[] {
  return seq.map((p) => ({ color: p.color, vol: p.vol * f }));
}

export interface TransportContext {
  /** Current liquid colour of each reservoir. */
  reservoirColor: (id: string) => string;
}

/**
 * Advance liquids by `dt` seconds under a (constant) flow solution. The caller must keep each step's
 * volume below a pipe's own volume (see maxStableDt).
 */
export function advance(s: Schematic, liq: LiquidState, sol: FlowSolution, dt: number, ctx: TransportContext): void {
  const inflow = new Map<string, Plug[][]>(); // component id → incoming sequences (exit order)
  const outputs = new Map<string, { pipeId: string; vol: number; atFrom: boolean }[]>();
  const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };

  // 1. Liquid leaves every moving pipe at its downstream end.
  for (const p of s.pipes) {
    const q = sol.pipeFlow.get(p.id) ?? 0;
    const plugs = liq.pipes.get(p.id);
    if (q === 0 || !plugs) continue;
    const v = (Math.abs(q) * dt) / 60;
    if (q > 0) {
      push(inflow, p.to.comp, takeFromEnd(plugs, v));
      push(outputs, p.from.comp, { pipeId: p.id, vol: v, atFrom: true });
    } else {
      push(inflow, p.from.comp, takeFromStart(plugs, v));
      push(outputs, p.to.comp, { pipeId: p.id, vol: v, atFrom: false });
    }
  }

  // 2. Each component turns what came in into what goes out.
  for (const c of s.components) {
    const ins = inflow.get(c.id) ?? [];
    const outs = outputs.get(c.id) ?? [];
    const outVol = outs.reduce((a, o) => a + o.vol, 0);

    let source: Plug[] | null = null;
    if (c.kind === 'pump') {
      const barrel = liq.syringes.get(c.id)!;
      // Aspirating: incoming liquid enters at the nozzle; what entered first ends up deeper.
      for (const seq of ins) barrel.unshift(...[...seq].reverse());
      liq.syringes.set(c.id, compact(barrel));
      if (outVol > 0) source = takeFromStart(liq.syringes.get(c.id)!, outVol);
    } else if (c.kind === 'reservoir') {
      if (outVol > 0) source = [{ color: ctx.reservoirColor(c.id), vol: outVol }];
    } else if (c.kind === 'waste') {
      if (outVol > 0) source = [{ color: EMPTY, vol: outVol }];
    } else if (ins.length === 1) {
      source = ins[0]; // single stream: pass the colour sequence through
    } else if (ins.length > 1) {
      const all = ins.flat();
      source = [{ color: blend(all), vol: totalVolume(all) }];
    }
    if (!outs.length) continue;

    const srcVol = source ? totalVolume(source) : 0;
    for (const o of outs) {
      const part = srcVol > TINY ? scaleSeq(source!, o.vol / srcVol) : [{ color: EMPTY, vol: o.vol }];
      const plugs = liq.pipes.get(o.pipeId)!;
      // Liquid that entered first is pushed furthest along.
      liq.pipes.set(o.pipeId, compact(o.atFrom ? [...[...part].reverse(), ...plugs] : [...plugs, ...part]));
    }
  }
}

/** Largest step (s) that moves at most half of any pipe's volume. */
export function maxStableDt(s: Schematic, sol: FlowSolution, pipeVolume: Map<string, number>): number {
  let dt = Infinity;
  for (const p of s.pipes) {
    const q = Math.abs(sol.pipeFlow.get(p.id) ?? 0);
    const v = pipeVolume.get(p.id) ?? 0;
    if (q > 0 && v > 0) dt = Math.min(dt, (0.5 * v * 60) / q);
  }
  return dt;
}

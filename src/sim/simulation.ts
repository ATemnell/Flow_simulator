import { pipeVolume_uL } from '../model/geometry';
import type { Pump, Schematic } from '../model/types';
import { defaultInputs, solveFlows, type FlowInputs, type FlowSolution } from './solver';
import { advance, initialLiquids, maxStableDt, totalVolume, type LiquidState } from './transport';

export interface SimEvent {
  t: number;
  message: string;
}

const MAX_SUBSTEPS = 5000;

/**
 * Owns the live state of a run: inputs (pump flows, valves, reservoir colours), the current flow
 * solution and the liquid contents. Flows are re-solved only when an input changes.
 */
export class Simulation {
  readonly schematic: Schematic;
  t = 0;
  inputs: FlowInputs;
  solution: FlowSolution;
  liquids: LiquidState;
  reservoirColor = new Map<string, string>();
  reservoirLiquid = new Map<string, string>();
  events: SimEvent[] = [];
  private pipeVolume = new Map<string, number>();
  private pumps: Pump[];

  constructor(s: Schematic) {
    this.schematic = s;
    this.inputs = defaultInputs(s);
    this.liquids = initialLiquids(s);
    this.pumps = s.components.filter((c): c is Pump => c.kind === 'pump');
    for (const c of s.components) {
      if (c.kind !== 'reservoir') continue;
      this.reservoirColor.set(c.id, c.color);
      this.reservoirLiquid.set(c.id, c.liquid);
    }
    for (const p of s.pipes) {
      try {
        this.pipeVolume.set(p.id, pipeVolume_uL(s, p));
      } catch {
        /* dangling */
      }
    }
    this.solution = solveFlows(s, this.inputs);
  }

  private resolve() {
    this.solution = solveFlows(this.schematic, this.inputs);
  }

  setPumpFlow(id: string, q: number) {
    this.inputs = { ...this.inputs, pumpFlow: { ...this.inputs.pumpFlow, [id]: q } };
    this.resolve();
  }

  setValve(id: string, open: boolean) {
    this.inputs = { ...this.inputs, valveOpen: { ...this.inputs.valveOpen, [id]: open } };
    this.resolve();
  }

  setReservoirColor(id: string, color: string) {
    this.reservoirColor.set(id, color);
  }

  /** Change the liquid a reservoir supplies (colour, and optionally its name). */
  setReservoir(id: string, color: string, liquid?: string) {
    this.reservoirColor.set(id, color);
    if (liquid !== undefined) this.reservoirLiquid.set(id, liquid);
  }

  /** Replace the contents of a syringe (e.g. a script setting the initial fill). */
  setSyringe(id: string, vol: number, color: string) {
    this.liquids.syringes.set(id, vol > 0 ? [{ color, vol }] : []);
  }

  pumpFill(id: string): number {
    return totalVolume(this.liquids.syringes.get(id) ?? []);
  }

  /** Seconds until a running pump hits empty (dispensing) or full (aspirating). */
  private timeToLimit(p: Pump): number {
    const q = this.inputs.pumpFlow[p.id] ?? 0;
    if (q === 0 || this.solution.issues.some((i) => i.components.includes(p.id))) return Infinity;
    const room = q > 0 ? this.pumpFill(p.id) : p.syringeVolume_uL - this.pumpFill(p.id);
    return (Math.max(0, room) * 60) / Math.abs(q);
  }

  /** Advance simulated time by `dt` seconds. */
  step(dt: number) {
    let remaining = dt;
    for (let n = 0; remaining > 1e-12 && n < MAX_SUBSTEPS; n++) {
      let h = Math.min(remaining, maxStableDt(this.schematic, this.solution, this.pipeVolume));
      let limited: Pump[] = [];
      for (const p of this.pumps) {
        const tl = this.timeToLimit(p);
        if (tl < h - 1e-12) {
          h = tl;
          limited = [p];
        } else if (Math.abs(tl - h) <= 1e-12) limited.push(p);
      }
      if (h > 0) advance(this.schematic, this.liquids, this.solution, h, { reservoirColor: (id) => this.reservoirColor.get(id) ?? '#888888' });
      this.t += h;
      remaining -= h;
      if (limited.length) {
        for (const p of limited) {
          const q = this.inputs.pumpFlow[p.id] ?? 0;
          this.events.push({ t: this.t, message: `${p.name} stopped: syringe ${q > 0 ? 'empty' : 'full'}.` });
          this.inputs = { ...this.inputs, pumpFlow: { ...this.inputs.pumpFlow, [p.id]: 0 } };
        }
        this.resolve();
      }
    }
  }
}

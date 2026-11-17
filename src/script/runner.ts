import type { Schematic } from '../model/types';
import { Simulation } from '../sim/simulation';
import type { Action, CompiledScript } from './compile';

interface TimedEvent {
  t: number;
  /** Lower runs first at the same time: scheduled pump stops before the next row's actions. */
  order: number;
  apply: (sim: Simulation) => void;
}

function applyAction(sim: Simulation, a: Action) {
  switch (a.type) {
    case 'pump':
      sim.setPumpFlow(a.id, a.flow);
      break;
    case 'stop':
      sim.setPumpFlow(a.id, 0);
      break;
    case 'valve':
      sim.setValve(a.id, a.open);
      break;
    case 'reservoir':
      sim.setReservoir(a.id, a.color, a.liquid);
      break;
    case 'fill': {
      const pump = sim.schematic.components.find((c) => c.id === a.id);
      const current = sim.liquids.syringes.get(a.id)?.[0]?.color;
      const color = a.color ?? current ?? (pump?.kind === 'pump' ? pump.initialColor : '#ffffff');
      sim.setSyringe(a.id, a.vol, color);
      break;
    }
  }
}

export function buildEvents(script: CompiledScript): TimedEvent[] {
  const events: TimedEvent[] = [];
  for (const step of script.steps) {
    events.push({ t: step.start, order: 1, apply: (sim) => step.actions.forEach((a) => applyAction(sim, a)) });
    for (const a of step.actions) {
      if (a.type === 'pump') {
        const end = step.start + (a.volume / Math.abs(a.flow)) * 60;
        events.push({ t: end, order: 0, apply: (sim) => sim.setPumpFlow(a.id, 0) });
      }
    }
  }
  return events.sort((a, b) => a.t - b.t || a.order - b.order);
}

/**
 * Plays a compiled script against a simulation. Deterministic, so seeking backwards replays from 0.
 */
export class ScriptRunner {
  readonly schematic: Schematic;
  readonly script: CompiledScript;
  sim: Simulation;
  private events: TimedEvent[];
  private next = 0;

  constructor(schematic: Schematic, script: CompiledScript) {
    this.schematic = schematic;
    this.script = script;
    this.events = buildEvents(script);
    this.sim = new Simulation(schematic);
    this.advanceTo(0);
  }

  get t() {
    return this.sim.t;
  }

  get duration() {
    return this.script.duration;
  }

  get done() {
    return this.sim.t >= this.script.duration - 1e-9 && this.next >= this.events.length;
  }

  advanceTo(target: number) {
    const end = Math.min(target, this.script.duration);
    while (this.next < this.events.length && this.events[this.next].t <= end + 1e-9) {
      const e = this.events[this.next];
      if (e.t > this.sim.t) this.sim.step(e.t - this.sim.t);
      e.apply(this.sim);
      this.next++;
    }
    if (end > this.sim.t) this.sim.step(end - this.sim.t);
  }

  seek(target: number) {
    if (target < this.sim.t - 1e-9) {
      this.sim = new Simulation(this.schematic);
      this.next = 0;
    }
    this.advanceTo(Math.max(0, target));
  }

  /** Index of the step running at the current time (the last one started), or -1 before the first. */
  currentStep(): number {
    const t = this.sim.t;
    let idx = -1;
    this.script.steps.forEach((s, i) => {
      if (s.start <= t + 1e-9) idx = i;
    });
    // A zero-length step is "current" only while nothing later has started.
    return idx;
  }
}

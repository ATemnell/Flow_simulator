import { create } from 'zustand';
import type { Schematic } from '../model/types';
import { Simulation } from '../sim/simulation';

/** Spacing of the flow-direction chevrons along a pipe (mm). */
export const CHEVRON_SPACING = 28;

interface RunState {
  sim: Simulation | null;
  playing: boolean;
  /** Simulated seconds per real second. */
  speed: number;
  /** Bumped every animation frame / input change so views re-render. */
  frame: number;
  /** Per pipe: chevron offset along the pipe (mm, 0..CHEVRON_SPACING). */
  arrowPhase: Map<string, number>;

  start: (s: Schematic) => void;
  stop: () => void;
  reset: () => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (x: number) => void;
  /** Apply a change to the simulation (pump flow, valve…) and refresh views. */
  mutate: (fn: (sim: Simulation) => void) => void;
  /** Advance by `realDt` seconds of wall-clock time. */
  tick: (realDt: number) => void;
}

/**
 * How fast chevrons move on screen. Real liquid speeds in microfluidics are often well below
 * 1 mm/s, so the chevron speed follows the simulated speed but is clamped to stay visible.
 */
function chevronSpeed(velocity_mm_s: number, speed: number): number {
  const v = Math.abs(velocity_mm_s) * speed;
  if (v === 0) return 0;
  return Math.min(90, Math.max(6, v));
}

export const useRun = create<RunState>((set, get) => ({
  sim: null,
  playing: false,
  speed: 10,
  frame: 0,
  arrowPhase: new Map(),

  start: (s) => set({ sim: new Simulation(s), playing: false, frame: 0, arrowPhase: new Map() }),
  stop: () => set({ sim: null, playing: false }),
  reset: () => {
    const sim = get().sim;
    if (sim) set({ sim: new Simulation(sim.schematic), playing: false, frame: get().frame + 1, arrowPhase: new Map() });
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  mutate: (fn) => {
    const sim = get().sim;
    if (!sim) return;
    fn(sim);
    set({ frame: get().frame + 1 });
  },
  tick: (realDt) => {
    const { sim, playing, speed, arrowPhase } = get();
    if (!sim || !playing) return;
    sim.step(realDt * speed);
    for (const p of sim.schematic.pipes) {
      const q = sim.solution.pipeFlow.get(p.id) ?? 0;
      const area = (Math.PI * p.innerDiameter_mm * p.innerDiameter_mm) / 4;
      const v = q / 60 / area; // mm/s along from→to
      const step = chevronSpeed(v, speed) * Math.sign(v) * realDt;
      const ph = (arrowPhase.get(p.id) ?? 0) + step;
      arrowPhase.set(p.id, ((ph % CHEVRON_SPACING) + CHEVRON_SPACING) % CHEVRON_SPACING);
    }
    set({ frame: get().frame + 1 });
  },
}));

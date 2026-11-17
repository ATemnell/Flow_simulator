import { create } from 'zustand';
import { channelArea } from '../model/geometry';
import type { Schematic } from '../model/types';
import type { CompiledScript } from '../script/compile';
import { ScriptRunner } from '../script/runner';
import { Simulation } from '../sim/simulation';

/** Spacing of the flow-direction chevrons along a pipe (mm). */
export const CHEVRON_SPACING = 28;

/** Who drives the run: the CSV script, or the manual test controls. */
export type Control = 'script' | 'manual';

interface RunState {
  control: Control;
  /** The simulation being displayed (the runner's, in script mode). */
  sim: Simulation | null;
  runner: ScriptRunner | null;
  /** Kept so the run can switch between script and manual control. */
  schematic: Schematic | null;
  script: CompiledScript | null;
  playing: boolean;
  /** Simulated seconds per real second. */
  speed: number;
  /** Bumped every animation frame / input change so views re-render. */
  frame: number;
  /** Per pipe: chevron offset along the pipe (mm, 0..CHEVRON_SPACING). */
  arrowPhase: Map<string, number>;

  /** Start a run; uses the script when it is runnable, otherwise manual control. */
  start: (s: Schematic, script: CompiledScript | null) => void;
  stop: () => void;
  reset: () => void;
  setControl: (c: Control) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (x: number) => void;
  /** Jump to a time in the script. */
  seek: (t: number) => void;
  /** Manual control: apply a change to the simulation (pump flow, valve…) and refresh views. */
  mutate: (fn: (sim: Simulation) => void) => void;
  /** Advance by `realDt` seconds of wall-clock time. */
  tick: (realDt: number) => void;
}

export const scriptRunnable = (c: CompiledScript | null): boolean => !!c && c.errors.length === 0 && c.steps.length > 0;

/**
 * How fast chevrons move on screen. Real liquid speeds in microfluidics are often well below
 * 1 mm/s, so the chevron speed follows the simulated speed but is clamped to stay visible.
 */
function chevronSpeed(velocity_mm_s: number, speed: number): number {
  const v = Math.abs(velocity_mm_s) * speed;
  if (v === 0) return 0;
  return Math.min(90, Math.max(6, v));
}

function fresh(control: Control, schematic: Schematic, script: CompiledScript | null) {
  if (control === 'script' && script && scriptRunnable(script)) {
    const runner = new ScriptRunner(schematic, script);
    return { control, runner, sim: runner.sim };
  }
  return { control: 'manual' as Control, runner: null, sim: new Simulation(schematic) };
}

export const useRun = create<RunState>((set, get) => ({
  control: 'script',
  sim: null,
  runner: null,
  schematic: null,
  script: null,
  playing: false,
  speed: 30,
  frame: 0,
  arrowPhase: new Map(),

  start: (schematic, script) => set({ ...fresh('script', schematic, script), schematic, script, playing: false, arrowPhase: new Map(), frame: get().frame + 1 }),
  stop: () => set({ sim: null, runner: null, playing: false }),
  reset: () => {
    const { schematic, script, control } = get();
    if (schematic) set({ ...fresh(control, schematic, script), playing: false, arrowPhase: new Map(), frame: get().frame + 1 });
  },
  setControl: (c) => {
    const { schematic, script } = get();
    if (schematic) set({ ...fresh(c, schematic, script), playing: false, arrowPhase: new Map(), frame: get().frame + 1 });
  },
  setPlaying: (playing) => {
    const { runner } = get();
    // Pressing play at the end of a script starts it again.
    if (playing && runner?.done) get().seek(0);
    set({ playing });
  },
  setSpeed: (speed) => set({ speed }),
  seek: (t) => {
    const { runner } = get();
    if (!runner) return;
    runner.seek(t);
    set({ sim: runner.sim, frame: get().frame + 1 });
  },
  mutate: (fn) => {
    const sim = get().sim;
    if (!sim || get().runner) return;
    fn(sim);
    set({ frame: get().frame + 1 });
  },
  tick: (realDt) => {
    const { sim, runner, playing, speed, arrowPhase } = get();
    if (!sim || !playing) return;
    if (runner) runner.advanceTo(runner.t + realDt * speed);
    else sim.step(realDt * speed);
    const cur = runner ? runner.sim : sim;
    for (const p of cur.schematic.pipes) {
      const q = cur.solution.pipeFlow.get(p.id) ?? 0;
      const area = channelArea(p);
      const v = q / 60 / area; // mm/s along from→to
      const step = chevronSpeed(v, speed) * Math.sign(v) * realDt;
      const ph = (arrowPhase.get(p.id) ?? 0) + step;
      arrowPhase.set(p.id, ((ph % CHEVRON_SPACING) + CHEVRON_SPACING) % CHEVRON_SPACING);
    }
    set({ sim: cur, frame: get().frame + 1, playing: runner ? !runner.done : true });
  },
}));

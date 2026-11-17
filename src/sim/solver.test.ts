import { describe, expect, it } from 'vitest';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import type { Component, Pipe, Schematic } from '../model/types';
import { defaultInputs, solveDense, solveFlows, type FlowInputs } from './solver';

// Small builders. Port positions: reservoir/waste port 30/20 mm above pos; pump port 50 mm right; valve ports ±20 mm.
const res = (id: string, x: number, y: number): Component => ({ id, kind: 'reservoir', name: id, pos: { x, y }, rotation: 0, liquid: 'L', color: '#00f' });
const waste = (id: string, x: number, y: number): Component => ({ id, kind: 'waste', name: id, pos: { x, y }, rotation: 0 });
const pump = (id: string, x: number, y: number, rotation: 0 | 180 = 0): Component => ({
  id,
  kind: 'pump',
  name: id,
  pos: { x, y },
  rotation,
  syringeVolume_uL: 500,
  initialFill_uL: 250,
  initialColor: '#f00',
});
const valve = (id: string, x: number, y: number, open = true): Component => ({ id, kind: 'valve', name: id, pos: { x, y }, rotation: 0, initialOpen: open });
const junction = (id: string, x: number, y: number): Component => ({ id, kind: 'junction', name: id, pos: { x, y }, rotation: 0 });
/** Channel of the default 0.3 × 0.35 mm cross-section, optionally scaled. */
const pipe = (id: string, from: string, fromPort: string, to: string, toPort: string, scale = 1, waypoints: Pipe['waypoints'] = []): Pipe => ({
  id,
  from: { comp: from, port: fromPort },
  to: { comp: to, port: toPort },
  waypoints,
  width_mm: 0.3 * scale,
  depth_mm: 0.35 * scale,
});
const schematic = (components: Component[], pipes: Pipe[]): Schematic => ({ version: 1, name: 't', components, pipes });
const run = (s: Schematic, pumpFlow: Record<string, number>, valveOpen: Record<string, boolean> = {}) => {
  const inputs: FlowInputs = defaultInputs(s);
  inputs.pumpFlow = pumpFlow;
  Object.assign(inputs.valveOpen, valveOpen);
  return solveFlows(s, inputs);
};

describe('solveDense', () => {
  it('solves a small system', () => {
    const x = solveDense([Float64Array.from([2, 1]), Float64Array.from([1, 3])], Float64Array.from([3, 5]));
    expect(x[0]).toBeCloseTo(0.8);
    expect(x[1]).toBeCloseTo(1.4);
  });
});

describe('series', () => {
  // Reservoir port (0,0) → pump port (100,0)
  const s = schematic([res('R', 0, 30), pump('P', 150, 0, 180)], [pipe('a', 'R', 'p', 'P', 'out')]);

  it('aspirating draws liquid from the reservoir to the pump', () => {
    const r = run(s, { P: -10 });
    expect(r.issues).toEqual([]);
    expect(r.pipeFlow.get('a')).toBeCloseTo(10);
    expect(r.portFlow.get('P:out')).toBeCloseTo(10); // into the syringe
    expect(r.portFlow.get('R:p')).toBeCloseTo(-10); // out of the reservoir
  });

  it('dispensing reverses the direction', () => {
    expect(run(s, { P: 10 }).pipeFlow.get('a')).toBeCloseTo(-10);
  });

  it('dispensing into waste: liquid leaves the system there', () => {
    // Pump port (50,0) → waste port (150,0)
    const w = schematic([pump('P', 0, 0), waste('W', 150, 20)], [pipe('a', 'P', 'out', 'W', 'p')]);
    const r = run(w, { P: 4 });
    expect(r.issues).toEqual([]);
    expect(r.portFlow.get('W:p')).toBeCloseTo(4);
  });

  it('an idle pump is a dead end: no flow', () => {
    expect(run(s, {}).pipeFlow.get('a')).toBe(0);
  });
});

describe('parallel channels split by conductance (a³b(1 − 0.63a/b)/L)', () => {
  // Reservoir → J1; J1 → J2 via two equal-length channels, the second twice as wide and deep; J2 → pump aspirating 17.
  // Doubling both sides multiplies a³b by 16 (the shape factor is unchanged).
  const s = schematic(
    [res('R', 0, 30), junction('J1', 100, 0), junction('J2', 200, 0), pump('P', 350, 0, 180)],
    [
      pipe('in', 'R', 'p', 'J1', 'j'),
      pipe('thin', 'J1', 'j', 'J2', 'j', 1, [
        { x: 100, y: -50 },
        { x: 200, y: -50 },
      ]),
      pipe('thick', 'J1', 'j', 'J2', 'j', 2, [
        { x: 100, y: 50 },
        { x: 200, y: 50 },
      ]),
      pipe('out', 'J2', 'j', 'P', 'out'),
    ],
  );

  it('flow splits 1:16', () => {
    const r = run(s, { P: -17 });
    expect(r.pipeFlow.get('thin')).toBeCloseTo(1);
    expect(r.pipeFlow.get('thick')).toBeCloseTo(16);
    expect(r.pipeFlow.get('in')).toBeCloseTo(17);
    expect(r.pipeFlow.get('out')).toBeCloseTo(17);
  });
});

describe('valves', () => {
  // Reservoir → V → pump
  const s = schematic(
    [res('R', 0, 30), valve('V', 80, 0, false), pump('P', 210, 0, 180)],
    [pipe('a', 'R', 'p', 'V', 'a'), pipe('b', 'V', 'b', 'P', 'out')],
  );

  it('a pump pushing against a closed valve is reported, with zero flow', () => {
    const r = run(s, { P: 10 });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].message).toMatch(/P cannot push 10 µL\/min.*closed: V/);
    expect(r.issues[0].components.sort()).toEqual(['P', 'V']);
    expect(r.pipeFlow.get('b')).toBe(0);
  });

  it('an idle pump behind a closed valve is fine', () => {
    expect(run(s, {}).issues).toEqual([]);
  });

  it('opening the valve lets liquid through', () => {
    const r = run(s, { P: 10 }, { V: true });
    expect(r.issues).toEqual([]);
    expect(r.pipeFlow.get('a')).toBeCloseTo(-10);
    expect(r.pipeFlow.get('b')).toBeCloseTo(-10);
  });
});

describe('closed sections', () => {
  // Pump A → pump B directly, no reservoir.
  const s = schematic([pump('A', 0, 0), pump('B', 150, 0, 180)], [pipe('a', 'A', 'out', 'B', 'out')]);

  it('balanced pumps in series move liquid', () => {
    const r = run(s, { A: 5, B: -5 });
    expect(r.issues).toEqual([]);
    expect(r.pipeFlow.get('a')).toBeCloseTo(5);
  });

  it('mismatched pumps in series are reported', () => {
    const r = run(s, { A: 5, B: -3 });
    expect(r.issues[0].message).toMatch(/A and B cannot push 2 µL\/min.*do not balance/);
    expect(r.pipeFlow.get('a')).toBe(0);
  });

  it('an unconnected running pump is reported', () => {
    const r = run(schematic([pump('A', 0, 0)], []), { A: 1 });
    expect(r.issues[0].message).toBe('A is running but not connected to anything.');
  });
});

describe('two-inlet flow cell example', () => {
  const s = twoInletFlowCell;
  const flow = (r: ReturnType<typeof run>, id: string) => r.pipeFlow.get(id) ?? NaN;

  it('P1 pushes x into inlet 2, P2 pulls 2x from the outlet → reservoir supplies x into inlet 1', () => {
    const x = 10;
    const r = run(s, { p1: x, p2: -2 * x }); // V1 open, V2 closed (initial states)
    expect(r.issues).toEqual([]);
    expect(flow(r, 'pipe1')).toBeCloseTo(x); // reservoir → V1
    expect(flow(r, 'pipe2')).toBeCloseTo(x); // V1 → inlet 1
    expect(flow(r, 'pipe3')).toBeCloseTo(x); // P1 → inlet 2
    expect(flow(r, 'pipe4')).toBeCloseTo(2 * x); // outlet → J1
    expect(flow(r, 'pipe5')).toBeCloseTo(2 * x); // J1 → P2
    expect(flow(r, 'pipe6')).toBe(0); // V2 closed
    // Equal inflows → each stream would fill half the cell.
    expect(r.portFlow.get('fc1:in0')).toBeCloseTo(r.portFlow.get('fc1:in1')!);
  });

  it('with V1 closed, the same pump settings are infeasible', () => {
    const r = run(s, { p1: 10, p2: -20 }, { v1: false });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].components).toContain('v1');
  });

  it('with V2 open, P1 output splits between reservoir and waste and volume is conserved', () => {
    const r = run(s, { p1: 10 }, { v2: true });
    expect(r.issues).toEqual([]);
    const toReservoir = -flow(r, 'pipe1'); // pipe1 is reservoir→V1, so negative = back into the reservoir
    const toWaste = flow(r, 'pipe7');
    expect(toReservoir).toBeGreaterThan(0);
    expect(toWaste).toBeGreaterThan(0);
    expect(toReservoir + toWaste).toBeCloseTo(10);
    expect(flow(r, 'pipe5')).toBe(0); // P2 idle: dead end
  });

  it('flow is conserved at every junction and component', () => {
    const r = run(s, { p1: 7, p2: -3 }, { v2: true });
    for (const c of s.components) {
      if (c.kind === 'junction' || c.kind === 'valve' || c.kind === 'flowcell') {
        const sum = [...r.portFlow].filter(([k]) => k.startsWith(`${c.id}:`)).reduce((a, [, q]) => a + q, 0);
        expect(Math.abs(sum)).toBeLessThan(1e-9);
      }
    }
  });
});

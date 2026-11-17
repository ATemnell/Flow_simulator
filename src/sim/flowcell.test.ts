import { describe, expect, it } from 'vitest';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import type { Component, Schematic } from '../model/types';
import { EMPTY } from './color';
import { sliceColor, streamsToSlabs, type Slab } from './flowcell';
import { Simulation } from './simulation';

const G = '#16a34a';
const R = '#dc2626';

describe('helpers', () => {
  it('splits simultaneous streams at every colour boundary', () => {
    // Stream A: 1 µL red then 1 µL green. Stream B: 2 µL blue. → two slabs, each half A, half B.
    const slabs = streamsToSlabs([
      [
        { color: '#ff0000', vol: 1 },
        { color: '#00ff00', vol: 1 },
      ],
      [{ color: '#0000ff', vol: 2 }],
    ]);
    expect(slabs).toEqual([
      {
        bands: [
          { color: '#ff0000', frac: 0.5 },
          { color: '#0000ff', frac: 0.5 },
        ],
        vol: 2,
      },
      {
        bands: [
          { color: '#00ff00', frac: 0.5 },
          { color: '#0000ff', frac: 0.5 },
        ],
        vol: 2,
      },
    ]);
  });

  it('slices the cross-section, blending only where a slice spans bands', () => {
    const bands = [
      { color: '#ff0000', frac: 0.25 },
      { color: '#0000ff', frac: 0.75 },
    ];
    expect(sliceColor(bands, 0, 0.25)).toBe('#ff0000');
    expect(sliceColor(bands, 0.25, 1)).toBe('#0000ff');
    expect(sliceColor(bands, 0, 0.5)).toBe('#800080');
  });
});

const lastSlab = (sim: Simulation, id: string): Slab => {
  const ch = sim.liquids.chambers.get(id)!;
  return ch[ch.length - 1];
};

describe('two-inlet flow cell example', () => {
  it('equal inflows fill half the chamber each (inlet 1 on top)', () => {
    const sim = new Simulation(twoInletFlowCell);
    sim.setPumpFlow('p1', 30); // red into inlet 2
    sim.setPumpFlow('p2', -60); // pull from the outlet → reservoir supplies 30 green into inlet 1
    sim.step(700);
    const s = lastSlab(sim, 'fc1');
    expect(s.bands.map((b) => b.color)).toEqual([G, R]);
    expect(s.bands[0].frac).toBeCloseTo(0.5);
    expect(sim.liquids.chambers.get('fc1')!.length).toBe(1); // steady: the whole chamber has this profile
  });

  it('the band ratio follows the pump ratio', () => {
    const sim = new Simulation(twoInletFlowCell);
    sim.setPumpFlow('p1', 20);
    sim.setPumpFlow('p2', -80); // reservoir supplies 60 → 75 % green, 25 % red
    sim.step(900);
    const s = lastSlab(sim, 'fc1');
    expect(s.bands[0]).toMatchObject({ color: G });
    expect(s.bands[0].frac).toBeCloseTo(0.75);
    expect(s.bands[1].frac).toBeCloseTo(0.25);
  });

  it('the chamber starts empty and a front crosses it over time', () => {
    const sim = new Simulation(twoInletFlowCell);
    expect(sim.liquids.chambers.get('fc1')).toEqual([{ bands: [{ color: EMPTY, frac: 1 }], vol: 20 }]);
    sim.setPumpFlow('p1', 30);
    sim.setPumpFlow('p2', -60);
    sim.step(445); // both liquids have just arrived (≈ 220 µL route at 30 µL/min)
    const ch = sim.liquids.chambers.get('fc1')!;
    expect(ch.length).toBeGreaterThan(1); // liquid at the inlet side, air still at the outlet side
    expect(ch[ch.length - 1].bands[0].color).toBe(EMPTY);
  });
});

describe('two outlets take separate slices', () => {
  // Symmetric layout: reservoir G → inlet 1, reservoir R → inlet 2; outlet 1 → pump A, outlet 2 → pump B.
  const comps: Component[] = [
    { id: 'fc', kind: 'flowcell', name: 'FC', pos: { x: 200, y: 0 }, rotation: 0, inlets: 2, outlets: 2 },
    { id: 'rg', kind: 'reservoir', name: 'RG', pos: { x: 60, y: -40 }, rotation: 0, liquid: 'g', color: G },
    { id: 'rr', kind: 'reservoir', name: 'RR', pos: { x: 60, y: 40 }, rotation: 180, liquid: 'r', color: R },
    { id: 'pa', kind: 'pump', name: 'A', pos: { x: 360, y: -10 }, rotation: 180, syringeVolume_uL: 1000, initialFill_uL: 0, initialColor: '#ffffff' },
    { id: 'pb', kind: 'pump', name: 'B', pos: { x: 360, y: 10 }, rotation: 180, syringeVolume_uL: 1000, initialFill_uL: 0, initialColor: '#ffffff' },
  ];
  const s: Schematic = {
    version: 1,
    name: 't',
    components: comps,
    pipes: [
      { id: 'g', from: { comp: 'rg', port: 'p' }, to: { comp: 'fc', port: 'in0' }, waypoints: [{ x: 60, y: -10 }], innerDiameter_mm: 1 },
      { id: 'r', from: { comp: 'rr', port: 'p' }, to: { comp: 'fc', port: 'in1' }, waypoints: [{ x: 60, y: 10 }], innerDiameter_mm: 1 },
      { id: 'a', from: { comp: 'fc', port: 'out0' }, to: { comp: 'pa', port: 'out' }, waypoints: [], innerDiameter_mm: 1 },
      { id: 'b', from: { comp: 'fc', port: 'out1' }, to: { comp: 'pb', port: 'out' }, waypoints: [], innerDiameter_mm: 1 },
    ],
  };

  it('outlet 1 carries only green and outlet 2 only red', () => {
    const sim = new Simulation(s);
    sim.setPumpFlow('pa', -10);
    sim.setPumpFlow('pb', -10);
    sim.step(1500);
    expect(sim.liquids.pipes.get('a')!.map((p) => p.color)).toEqual([G]);
    expect(sim.liquids.pipes.get('b')!.map((p) => p.color)).toEqual([R]);
    expect(sim.liquids.syringes.get('pa')!.some((p) => p.color === R)).toBe(false);
  });

  it('pulling harder on outlet 1 makes it take some red too', () => {
    const sim = new Simulation(s);
    sim.setPumpFlow('pa', -15); // outlet 1 takes the top 75 % of a 50/50 profile
    sim.setPumpFlow('pb', -5);
    sim.step(1500);
    const a = sim.liquids.pipes.get('a')!;
    expect(a[0].color).not.toBe(G); // a green/red mix (2:1)
    expect(sim.liquids.pipes.get('b')!.map((p) => p.color)).toEqual([R]);
  });
});

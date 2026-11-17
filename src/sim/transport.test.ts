import { describe, expect, it } from 'vitest';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { pipeVolume_uL } from '../model/geometry';
import type { Component, Schematic } from '../model/types';
import { blend, EMPTY } from './color';
import { Simulation } from './simulation';
import { compact, takeFromEnd, takeFromStart, totalVolume, type Plug } from './transport';

const RED = '#ff0000';
const GREEN = '#00ff00';

describe('plug list helpers', () => {
  it('takes from the end in exit order', () => {
    const plugs: Plug[] = [
      { color: RED, vol: 2 },
      { color: GREEN, vol: 3 },
    ];
    expect(takeFromEnd(plugs, 4)).toEqual([
      { color: GREEN, vol: 3 },
      { color: RED, vol: 1 },
    ]);
    expect(plugs).toEqual([{ color: RED, vol: 1 }]);
  });

  it('takes from the start and pads with air when short', () => {
    const plugs: Plug[] = [{ color: RED, vol: 1 }];
    expect(takeFromStart(plugs, 1.5)).toEqual([
      { color: RED, vol: 1 },
      { color: EMPTY, vol: 0.5 },
    ]);
  });

  it('compacts neighbours of the same colour', () => {
    expect(
      compact([
        { color: RED, vol: 1 },
        { color: RED, vol: 2 },
        { color: GREEN, vol: 0 },
        { color: GREEN, vol: 1 },
      ]),
    ).toEqual([
      { color: RED, vol: 3 },
      { color: GREEN, vol: 1 },
    ]);
  });

  it('blends by volume and ignores air', () => {
    expect(
      blend([
        { color: '#ff0000', vol: 1 },
        { color: '#0000ff', vol: 1 },
        { color: EMPTY, vol: 5 },
      ]),
    ).toBe('#800080');
  });
});

/** Reservoir → pipe (100 mm, d=1) → pump. */
function line(): Schematic {
  const components: Component[] = [
    { id: 'R', kind: 'reservoir', name: 'R', pos: { x: 0, y: 30 }, rotation: 0, liquid: 'L', color: GREEN },
    { id: 'P', kind: 'pump', name: 'P', pos: { x: 150, y: 0 }, rotation: 180, syringeVolume_uL: 500, initialFill_uL: 0, initialColor: '#ffffff' },
  ];
  return { version: 1, name: 't', components, pipes: [{ id: 'a', from: { comp: 'R', port: 'p' }, to: { comp: 'P', port: 'out' }, waypoints: [], innerDiameter_mm: 1 }] };
}

describe('simulation', () => {
  it('a liquid front advances by volume and the syringe fills', () => {
    const s = line();
    const V = pipeVolume_uL(s, s.pipes[0]); // about 78.5 µL
    const sim = new Simulation(s);
    sim.setPumpFlow('P', -60); // aspirate 60 µL/min = 1 µL/s
    sim.step(30);
    const plugs = sim.liquids.pipes.get('a')!;
    // 30 µL of green entered at the reservoir end; the air ahead of it moved on into the syringe.
    expect(plugs[0].color).toBe(GREEN);
    expect(plugs[0].vol).toBeCloseTo(30);
    expect(totalVolume(plugs)).toBeCloseTo(V);
    expect(sim.pumpFill('P')).toBeCloseTo(30);
    expect(sim.t).toBeCloseTo(30);
  });

  it('a new colour follows the old one until the pipe is fully replaced', () => {
    const s = line();
    const V = pipeVolume_uL(s, s.pipes[0]);
    const sim = new Simulation(s);
    sim.setPumpFlow('P', -60);
    sim.step(V + 1); // pipe now full of green
    expect(sim.liquids.pipes.get('a')!.map((p) => p.color)).toEqual([GREEN]);
    sim.setReservoirColor('R', RED);
    sim.step(20);
    const plugs = sim.liquids.pipes.get('a')!;
    expect(plugs.map((p) => p.color)).toEqual([RED, GREEN]);
    expect(plugs[0].vol).toBeCloseTo(20);
    sim.step(V);
    expect(sim.liquids.pipes.get('a')!.map((p) => p.color)).toEqual([RED]);
  });

  it('dispensing pushes syringe contents out and stops the pump when empty', () => {
    const s = line();
    (s.components[1] as Extract<Component, { kind: 'pump' }>).initialFill_uL = 10;
    (s.components[1] as Extract<Component, { kind: 'pump' }>).initialColor = RED;
    const sim = new Simulation(s);
    sim.setPumpFlow('P', 60);
    sim.step(30);
    expect(sim.pumpFill('P')).toBeCloseTo(0);
    expect(sim.inputs.pumpFlow.P).toBe(0);
    expect(sim.events[0]).toMatchObject({ message: 'P stopped: syringe empty.' });
    expect(sim.events[0].t).toBeCloseTo(10);
    // 10 µL of red now sits at the pump end of the pipe.
    const plugs = sim.liquids.pipes.get('a')!;
    expect(plugs[plugs.length - 1]).toMatchObject({ color: RED });
    expect(plugs[plugs.length - 1].vol).toBeCloseTo(10);
  });

  it('liquids meeting downstream are blended; volume is conserved everywhere', () => {
    const s = twoInletFlowCell; // reservoir green into inlet 1, pump 1 red into inlet 2
    const sim = new Simulation(s);
    const volumes = new Map(s.pipes.map((p) => [p.id, pipeVolume_uL(s, p)]));
    sim.setPumpFlow('p1', 30);
    sim.setPumpFlow('p2', -60);
    sim.step(600); // each liquid needs about 220 µL (440 s) to reach the flow cell
    for (const p of s.pipes) expect(totalVolume(sim.liquids.pipes.get(p.id)!)).toBeCloseTo(volumes.get(p.id)!, 6);
    // The outlet carries an even green/red mix (the flow cell is a mixing node until phase 5).
    const out = sim.liquids.pipes.get('pipe4')!;
    expect(out[0].color).toBe(
      blend([
        { color: '#16a34a', vol: 1 },
        { color: '#dc2626', vol: 1 },
      ]),
    );
    // Pump 1 dispensed 300 of its 400 µL; Pump 2 took in 600 µL.
    expect(sim.pumpFill('p1')).toBeCloseTo(100);
    expect(sim.pumpFill('p2')).toBeCloseTo(600);
  });
});

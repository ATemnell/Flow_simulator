import { describe, expect, it } from 'vitest';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { twoInletFlowCellScript } from '../examples/twoInletFlowCellScript';
import { compileScript, splitCsvLine } from './compile';
import { ScriptRunner } from './runner';
import { DEFAULT_UNITS } from './units';

const s = twoInletFlowCell;
const compile = (text: string, units = DEFAULT_UNITS) => compileScript(text, s, units);

describe('CSV splitting', () => {
  it('handles quotes and trims', () => {
    expect(splitCsvLine(' a , "b, c" ,', ',')).toEqual(['a', 'b, c', '']);
  });
});

describe('compileScript', () => {
  it("compiles the user's original example", () => {
    const c = compile(`Pump 1, Pump 2, Valve 1, Valve 2,
100 10, -100 -10, 0, 1
Wait 2
50 10, 0 0, 1, 0`);
    expect(c.errors).toEqual([]);
    expect(c.columns.map((k) => k.id)).toEqual(['p1', 'p2', 'v1', 'v2']);
    expect(c.steps.map((x) => [x.kind, x.start, x.duration])).toEqual([
      ['row', 0, 600], // 100 µL at 10 µL/min = 10 min
      ['wait', 600, 2],
      ['row', 602, 300],
    ]);
    expect(c.steps[0].actions).toEqual([
      { type: 'pump', id: 'p1', flow: 10, volume: 100 },
      { type: 'pump', id: 'p2', flow: -10, volume: 100 },
      { type: 'valve', id: 'v1', open: false },
      { type: 'valve', id: 'v2', open: true },
    ]);
    expect(c.duration).toBe(902);
  });

  it('a row lasts as long as its slowest pump', () => {
    const c = compile(`Pump 1, Pump 2\n10 10, 30 10`);
    expect(c.steps[0].duration).toBe(180);
  });

  it('reads fill, reservoir liquid and colour, comments and blank lines', () => {
    const c = compile(`# comment

Pump 1, Reservoir A
fill 250 blue, Sample #2563EB
, red`);
    expect(c.errors).toEqual([]);
    expect(c.steps[0].actions).toEqual([
      { type: 'fill', id: 'p1', vol: 250, color: '#0000ff' },
      { type: 'stop', id: 'p1' },
      { type: 'reservoir', id: 'resA', color: '#2563eb', liquid: 'Sample' },
    ]);
    expect(c.steps[1].actions[1]).toEqual({ type: 'reservoir', id: 'resA', color: '#ff0000', liquid: undefined });
  });

  it('header names are case-insensitive and semicolons with decimal commas work', () => {
    const c = compile(`pump 1; VALVE 1\n2,5 0,5; 1`);
    expect(c.errors).toEqual([]);
    expect(c.steps[0].actions[0]).toEqual({ type: 'pump', id: 'p1', flow: 0.5, volume: 2.5 });
  });

  it('applies the unit settings', () => {
    const c = compile(`Pump 1\n0.1 0.05\nWait 2`, { volume: 'mL', flow: 'mL/min', time: 'min' });
    expect(c.steps[0].actions[0]).toEqual({ type: 'pump', id: 'p1', flow: 50, volume: 100 });
    expect(c.steps[0].duration).toBe(120);
    expect(c.steps[1].duration).toBe(120);
    expect(compile(`Pump 1\nWait 30 s`, { ...DEFAULT_UNITS, time: 'min' }).steps[0].duration).toBe(30);
  });

  it('reports clear errors with line numbers', () => {
    const c = compile(`Pump 1, Pump 9, Flow cell, Valve 1, Reservoir A
100 -10, , , maybe, gren
fill 9999, , , ,
Wait soon
1 2, 3 4, 5 6, 7 8, 9 10, 11 12`);
    const msgs = c.errors.map((e) => `${e.line}: ${e.message}`);
    expect(msgs).toEqual([
      "1: No part named 'Pump 9'. Controllable parts: Reservoir A, Valve 1, Pump 1, Pump 2, Valve 2.",
      "1: 'Flow cell' (flow cell) has nothing to control; remove this column.",
      "2: Pump 1: volume and flow have different signs; use '-100 -10' to aspirate or '100 10' to dispense.",
      "2: Valve 1: use 1 (open) or 0 (closed), not 'maybe'.",
      "2: Reservoir A: end the cell with a colour, e.g. 'red', '#2563eb' or 'Sample blue' ('gren' is not a colour).",
      '3: Pump 1: fill 9999 µL is more than the 500 µL syringe holds.',
      "4: Write a wait as 'Wait 2' or 'Wait 1.5 min'.",
      '5: This row has 6 values but the header has 5 columns.',
      "5: Valve 1: use 1 (open) or 0 (closed), not '7 8'.",
      "5: Reservoir A: end the cell with a colour, e.g. 'red', '#2563eb' or 'Sample blue' ('10' is not a colour).",
    ]);
  });

  it('warns when a syringe would run empty or overfill', () => {
    const c = compile(`Pump 1, Pump 2\n450 50, -1200 -100`);
    expect(c.warnings.map((w) => w.message)).toEqual([
      'Pump 1 dispenses 450 µL but only 400 µL is in the syringe; it will stop early.',
      'Pump 2 aspirates 1200 µL but only 1000 µL fits in the syringe; it will stop early.',
    ]);
  });

  it('the bundled demo script compiles cleanly', () => {
    const c = compile(twoInletFlowCellScript);
    expect(c.errors).toEqual([]);
    expect(c.warnings).toEqual([]);
    expect(c.duration).toBe(120 + 240 + 0 + 600 + 30 + 300);
  });
});

describe('ScriptRunner', () => {
  it("runs the user's example: pumps stop after their volume, valves switch per row", () => {
    const r = new ScriptRunner(
      s,
      compile(`Pump 1, Pump 2, Valve 1, Valve 2
100 10, -50 -10, 1, 0
Wait 2
, , 0, 1`),
    );
    expect(r.sim.inputs.pumpFlow).toEqual({ p1: 10, p2: -10 });
    r.advanceTo(301); // pump 2 (50 µL) done at 300 s, pump 1 runs until 600 s
    expect(r.sim.inputs.pumpFlow.p2).toBe(0);
    expect(r.sim.inputs.pumpFlow.p1).toBe(10);
    expect(r.currentStep()).toBe(0);
    r.advanceTo(601);
    expect(r.currentStep()).toBe(1); // waiting
    expect(r.sim.inputs.pumpFlow.p1).toBe(0);
    expect(r.sim.pumpFill('p1')).toBeCloseTo(300);
    r.advanceTo(10_000);
    expect(r.done).toBe(true);
    expect(r.sim.inputs.valveOpen).toMatchObject({ v1: false, v2: true });
    expect(r.t).toBe(602);
  });

  it('fill and reservoir actions apply at the start of their row', () => {
    const r = new ScriptRunner(s, compile(`Pump 2, Reservoir A\nfill 300 purple, Sample blue`));
    expect(r.sim.pumpFill('p2')).toBe(300);
    expect(r.sim.liquids.syringes.get('p2')![0].color).toBe('#800080');
    expect(r.sim.reservoirColor.get('resA')).toBe('#0000ff');
    expect(r.sim.reservoirLiquid.get('resA')).toBe('Sample');
  });

  it('seeking backwards replays deterministically', () => {
    const c = compile(twoInletFlowCellScript);
    const a = new ScriptRunner(s, c);
    a.advanceTo(500);
    const snapshot = JSON.stringify([...a.sim.liquids.pipes]);
    a.advanceTo(900);
    a.seek(500);
    expect(a.t).toBeCloseTo(500);
    expect(JSON.stringify([...a.sim.liquids.pipes])).toBe(snapshot);
  });

  it('the demo shows the blue sample reaching the flow cell', () => {
    const r = new ScriptRunner(s, compile(twoInletFlowCellScript));
    r.advanceTo(120 + 240 + 600); // end of the sample row
    const chamber = r.sim.liquids.chambers.get('fc1')!;
    expect(chamber.some((slab) => slab.bands[0].color === '#2563eb')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { Simulation } from '../sim/simulation';
import { defaultInputs, solveFlows } from '../sim/solver';
import { addComponent, addPipe, autoConnect, connectEnd, findInlineSpot, insertInline, isConnected, makeComponent, moveComponent, moveFreeEnd } from './edit';
import { pipePoints } from './geometry';
import { validateSchematic } from './serialize';
import { endComp, type Schematic } from './types';

const empty: Schematic = { version: 1, name: 't', components: [], pipes: [] };
const pipe = (s: Schematic, id: string) => s.pipes.find((p) => p.id === id)!;

describe('pipes with open ends', () => {
  it('can be drawn with both ends unconnected and are valid', () => {
    const { schematic: s, id } = addPipe(empty, { free: { x: 0, y: 0 } }, { free: { x: 100, y: 50 } }, [{ x: 100, y: 0 }]);
    expect(validateSchematic(s)).toEqual([]);
    expect(pipePoints(s, pipe(s, id))).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
  });

  it('an open end moves on the grid and keeps the pipe orthogonal', () => {
    const { schematic: s0, id } = addPipe(empty, { free: { x: 0, y: 0 } }, { free: { x: 100, y: 50 } }, [{ x: 100, y: 0 }]);
    const s = moveFreeEnd(s0, id, 'to', { x: 141, y: 79 });
    expect(pipePoints(s, pipe(s, id))).toEqual([
      { x: 0, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 80 },
    ]);
  });

  it('moving the end of a straight pipe adds a corner instead of going diagonal', () => {
    const { schematic: s0, id } = addPipe(empty, { free: { x: 400, y: 60 } }, { free: { x: 500, y: 60 } }, []);
    const s = moveFreeEnd(s0, id, 'to', { x: 500, y: 210 });
    expect(pipePoints(s, pipe(s, id))).toEqual([
      { x: 400, y: 60 },
      { x: 500, y: 60 },
      { x: 500, y: 210 },
    ]);
  });

  it('an open end can be connected to a port', () => {
    const r = makeComponent(empty, 'reservoir', { x: 100, y: 80 }); // port at (100, 50)
    const s0 = addComponent(empty, r);
    const { schematic: s1, id } = addPipe(s0, { free: { x: 0, y: 0 } }, { free: { x: 100, y: 50 } }, [{ x: 100, y: 0 }]);
    const s = connectEnd(s1, id, 'to', { comp: r.id, port: 'p' });
    expect(pipe(s, id).to).toEqual({ comp: r.id, port: 'p' });
    expect(validateSchematic(s)).toEqual([]);
  });

  it('placing a part with a port on an open end connects it automatically', () => {
    const { schematic: s0, id } = addPipe(empty, { free: { x: 0, y: 0 } }, { free: { x: 100, y: 0 } }, []);
    const pump = makeComponent(s0, 'pump', { x: 150, y: 0 }); // port 'out' at (200, 0): not on the end
    let s = autoConnect(addComponent(s0, pump), pump.id);
    expect(isConnected(s, pump.id)).toBe(false);
    s = autoConnect(moveComponent(s, pump.id, { x: 50, y: 0 }), pump.id); // port now at (100, 0)
    expect(pipe(s, id).to).toEqual({ comp: pump.id, port: 'out' });
  });

  it('open ends are sealed in the simulation: no flow, no error', () => {
    const { schematic: s0 } = addPipe(empty, { free: { x: 0, y: 0 } }, { free: { x: 100, y: 0 } }, []);
    const pump = makeComponent(s0, 'pump', { x: 50, y: 0 });
    const s = autoConnect(addComponent(s0, pump), pump.id);
    const idle = solveFlows(s, defaultInputs(s));
    expect(idle.issues).toEqual([]);
    const pushing = solveFlows(s, { ...defaultInputs(s), pumpFlow: { [pump.id]: 10 } });
    expect(pushing.issues[0].message).toMatch(/no open path to a reservoir or waste/);
    expect(() => new Simulation(s).step(10)).not.toThrow();
  });
});

describe('placing a valve on a pipe', () => {
  it('finds a spot on a straight segment and aligns the valve with it', () => {
    // pipe3 runs (200,80) → (300,80) → (300,210) → (340,210)
    expect(findInlineSpot(twoInletFlowCell, { x: 252, y: 84 })).toEqual({ pipeId: 'pipe3', pos: { x: 250, y: 80 }, rotation: 0 });
    expect(findInlineSpot(twoInletFlowCell, { x: 303, y: 140 })).toEqual({ pipeId: 'pipe3', pos: { x: 300, y: 140 }, rotation: 90 });
  });

  it('needs room for both ports', () => {
    expect(findInlineSpot(twoInletFlowCell, { x: 320, y: 210 })).toBeNull(); // last segment is only 40 mm
    expect(findInlineSpot(twoInletFlowCell, { x: 210, y: 80 })).toBeNull(); // too close to the pump
  });

  it('cuts the pipe and connects both halves to the valve', () => {
    const spot = findInlineSpot(twoInletFlowCell, { x: 300, y: 140 })!;
    const v = { ...makeComponent(twoInletFlowCell, 'valve', spot.pos), rotation: spot.rotation };
    const s = insertInline(addComponent(twoInletFlowCell, v), v.id, spot.pipeId);
    expect(validateSchematic(s)).toEqual([]);
    const halves = s.pipes.filter((p) => endComp(p.from) === v.id || endComp(p.to) === v.id);
    expect(halves).toHaveLength(2);
    // Pump 1 → valve port a (above), valve port b (below) → flow cell inlet 2.
    expect(halves.find((p) => endComp(p.from) === 'p1')!.to).toEqual({ comp: v.id, port: 'a' });
    expect(halves.find((p) => endComp(p.to) === 'fc1')!.from).toEqual({ comp: v.id, port: 'b' });
    // Liquid still flows through the new valve.
    const sol = solveFlows(s, { ...defaultInputs(s), pumpFlow: { p1: 10, p2: -20 } });
    expect(sol.issues).toEqual([]);
    for (const h of halves) expect(sol.pipeFlow.get(h.id)).toBeCloseTo(10);
  });
});

describe('flow cell volume', () => {
  it('a larger chamber takes longer to fill', () => {
    const big = { ...twoInletFlowCell, components: twoInletFlowCell.components.map((c) => (c.kind === 'flowcell' ? { ...c, volume_uL: 200 } : c)) };
    const sim = new Simulation(big);
    expect(sim.liquids.chambers.get('fc1')![0].vol).toBe(200);
    sim.setPumpFlow('p1', 30);
    sim.setPumpFlow('p2', -60);
    sim.step(120); // 20 µL would long be full; 200 µL needs ≈ 60 s + 200 s
    const ch = sim.liquids.chambers.get('fc1')!;
    expect(ch[ch.length - 1].bands[0].color).toBe(''); // still air at the outlet side
  });
});

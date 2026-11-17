import { describe, expect, it } from 'vitest';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { pipeLength_mm, pipeVolume_uL, portPosition, rotate } from './geometry';
import { parseSchematic, serializeSchematic, validateSchematic } from './serialize';
import type { Schematic } from './types';

const clone = (s: Schematic): Schematic => JSON.parse(JSON.stringify(s));

describe('geometry', () => {
  it('rotates clockwise in screen coordinates', () => {
    expect(rotate({ x: 1, y: 0 }, 90)).toEqual({ x: -0, y: 1 });
    expect(rotate({ x: 1, y: 0 }, 180)).toEqual({ x: -1, y: -0 });
    expect(rotate({ x: 1, y: 0 }, 270)).toEqual({ x: 0, y: -1 });
  });

  it('places ports of rotated components', () => {
    const s = twoInletFlowCell;
    expect(portPosition(s, 'p2', 'out')).toEqual({ x: 600, y: 200 });
    expect(portPosition(s, 'v2', 'a')).toEqual({ x: 520, y: 270 });
    expect(portPosition(s, 'fc1', 'in0')).toEqual({ x: 340, y: 190 });
    expect(portPosition(s, 'fc1', 'in1')).toEqual({ x: 340, y: 210 });
  });

  it('computes pipe length and volume', () => {
    const s = twoInletFlowCell;
    const pipe3 = s.pipes.find((p) => p.id === 'pipe3')!;
    // (200,80) → (300,80) → (300,210) → (340,210)
    expect(pipeLength_mm(s, pipe3)).toBe(100 + 130 + 40);
    expect(pipeVolume_uL(s, pipe3)).toBeCloseTo(Math.PI * 0.25 * 270);
  });
});

describe('serialization', () => {
  it('round-trips the example', () => {
    const s = parseSchematic(serializeSchematic(twoInletFlowCell));
    expect(s).toEqual(twoInletFlowCell);
  });

  it('example is valid', () => {
    expect(validateSchematic(twoInletFlowCell)).toEqual([]);
  });

  it('rejects bad references and double-used ports', () => {
    const s = clone(twoInletFlowCell);
    s.pipes.push({ id: 'bad', from: { comp: 'nope', port: 'x' }, to: { comp: 'fc1', port: 'in0' }, waypoints: [], innerDiameter_mm: 1 });
    const problems = validateSchematic(s);
    expect(problems.some((p) => p.includes("unknown component 'nope'"))).toBe(true);
    expect(problems.some((p) => p.includes("Port 'in0'"))).toBe(true);
  });

  it('rejects invalid JSON and wrong versions', () => {
    expect(() => parseSchematic('{')).toThrow(/Not valid JSON/);
    expect(() => parseSchematic('{"version":99,"components":[],"pipes":[]}')).toThrow(/version/);
  });
});

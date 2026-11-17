import { describe, expect, it } from 'vitest';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { findHops, hoppedPath } from './crossings';
import {
  addPipe,
  deleteComponent,
  deletePipe,
  dragSegment,
  makeComponent,
  moveComponent,
  portIsFree,
  rotateComponent,
  simplifyPolyline,
  splitPipe,
  updateComponent,
} from './edit';
import { pipePoints, portPosition } from './geometry';
import { validateSchematic } from './serialize';
import { endComp, type Schematic } from './types';

const ex: Schematic = twoInletFlowCell;
const pipe = (s: Schematic, id: string) => s.pipes.find((p) => p.id === id)!;
const isOrthogonal = (s: Schematic, id: string) => {
  const pts = pipePoints(s, pipe(s, id));
  return pts.slice(1).every((b, i) => b.x === pts[i].x || b.y === pts[i].y);
};

describe('simplifyPolyline', () => {
  it('drops duplicates and collinear points', () => {
    expect(
      simplifyPolyline([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
  });
  it('keeps a U-turn', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 0 },
    ];
    expect(simplifyPolyline(pts)).toEqual(pts);
  });
});

describe('component edits', () => {
  it('creates components with unique ids and names', () => {
    const c = makeComponent(ex, 'pump', { x: 13, y: 27 });
    expect(c.id).toBe('pump1');
    expect(c.name).toBe('Pump 3');
    expect(c.pos).toEqual({ x: 10, y: 30 });
  });

  it('moving keeps attached pipe segments orthogonal', () => {
    // Pump 1 feeds pipe3 horizontally to (300,80) then down.
    const s = moveComponent(ex, 'p1', { x: 150, y: 50 });
    expect(portPosition(s, 'p1', 'out')).toEqual({ x: 200, y: 50 });
    expect(isOrthogonal(s, 'pipe3')).toBe(true);
    expect(pipe(s, 'pipe3').waypoints[0]).toEqual({ x: 300, y: 50 });
  });

  it('rotating keeps attached pipes connected and valid', () => {
    const s = rotateComponent(ex, 'v1');
    expect(validateSchematic(s)).toEqual([]);
    expect(s.components.find((c) => c.id === 'v1')!.rotation).toBe(90);
  });

  it('deleting a part keeps its pipes, with open ends where its ports were', () => {
    const s = deleteComponent(ex, 'v2');
    expect(s.components.some((c) => c.id === 'v2')).toBe(false);
    expect(pipe(s, 'pipe6').to).toEqual({ free: { x: 520, y: 270 } });
    expect(pipe(s, 'pipe7').from).toEqual({ free: { x: 520, y: 310 } });
    expect(s.components.some((c) => c.id === 'j1')).toBe(true); // still has three pipes
    expect(validateSchematic(s)).toEqual([]);
  });

  it('deleting a pipe merges a junction left with two pipes', () => {
    const s = deletePipe(ex, 'pipe6');
    expect(s.components.some((c) => c.id === 'j1')).toBe(false);
    expect(s.pipes.some((p) => endComp(p.from) === 'fc1' && endComp(p.to) === 'p2')).toBe(true);
    expect(validateSchematic(s)).toEqual([]);
  });

  it('reducing flow cell inlets leaves the pipe with an open end', () => {
    const s = updateComponent(ex, 'fc1', { inlets: 1 } as never);
    expect(pipe(s, 'pipe3').to).toEqual({ free: { x: 340, y: 210 } });
    expect(validateSchematic(s)).toEqual([]);
  });
});

describe('pipe edits', () => {
  it('splits a pipe into a T-junction', () => {
    const { schematic: s, junctionId } = splitPipe(ex, 'pipe2', { x: 293, y: 192 });
    const j = s.components.find((c) => c.id === junctionId)!;
    expect(j.pos).toEqual({ x: 290, y: 190 });
    const attached = s.pipes.filter((p) => endComp(p.from) === junctionId || endComp(p.to) === junctionId);
    expect(attached).toHaveLength(2);
    expect(validateSchematic(s)).toEqual([]);
  });

  it('a T-junction can then take a third pipe, and deleting it merges back', () => {
    const { schematic: s1, junctionId } = splitPipe(ex, 'pipe2', { x: 290, y: 190 });
    const r = makeComponent(s1, 'reservoir', { x: 290, y: 320 });
    const s2 = { ...s1, components: [...s1.components, r] };
    expect(portIsFree(s2, { comp: junctionId, port: 'j' })).toBe(true);
    const { schematic: s3, id } = addPipe(s2, { comp: r.id, port: 'p' }, { comp: junctionId, port: 'j' }, []);
    expect(validateSchematic(s3)).toEqual([]);
    const s4 = deletePipe(s3, id);
    expect(s4.components.some((c) => c.id === junctionId)).toBe(false);
    expect(validateSchematic(s4)).toEqual([]);
  });

  it('ports are single-use except junctions', () => {
    expect(portIsFree(ex, { comp: 'fc1', port: 'in0' })).toBe(false);
    expect(portIsFree(ex, { comp: 'j1', port: 'j' })).toBe(true);
  });

  it('drags an interior segment perpendicular to itself', () => {
    // pipe3: (200,80) → (300,80) → (300,210) → (340,210); segment 1 is vertical.
    const s = dragSegment(ex, 'pipe3', 1, { x: 22, y: 999 });
    expect(pipe(s, 'pipe3').waypoints).toEqual([
      { x: 320, y: 80 },
      { x: 320, y: 210 },
    ]);
  });

  it('dragging a segment attached to a port inserts a stub so the port stays put', () => {
    const s = dragSegment(ex, 'pipe2', 0, { x: 0, y: 30 });
    expect(isOrthogonal(s, 'pipe2')).toBe(true);
    const pts = pipePoints(s, pipe(s, 'pipe2'));
    expect(pts[0]).toEqual({ x: 240, y: 190 });
    expect(pts[pts.length - 1]).toEqual({ x: 340, y: 190 });
    expect(pts.some((p) => p.y === 220)).toBe(true);
  });
});

describe('crossings', () => {
  it('finds the deliberate crossing in the example; the later pipe hops', () => {
    const hops = findHops(ex);
    expect([...hops.keys()]).toEqual(['pipe3']);
    // pipe3 segment 1 runs (300,80)→(300,210); pipe2 is at y=190 → 110 along.
    expect(hops.get('pipe3')![0]).toMatchObject({ segment: 1, at: 110 });
  });

  it('pipes meeting at a junction are not crossings', () => {
    expect(findHops(ex).has('pipe5')).toBe(false);
    expect(findHops(ex).has('pipe6')).toBe(false);
  });

  it('renders an arc for each hop', () => {
    const d = hoppedPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [{ segment: 0, at: 50, r: 8 }],
    );
    expect(d).toBe('M 0 0 L 42 0 A 8 8 0 0 1 58 0 L 100 0');
  });
});

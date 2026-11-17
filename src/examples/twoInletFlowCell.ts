import type { Schematic } from '../model/types';

/**
 * Reservoir A → V1 → flow cell inlet 0; pump P1 → inlet 1.
 * Outlet → T-junction J1 → pump P2 (aspirates) and → V2 → waste.
 * The P1 pipe deliberately crosses the V1 pipe (no connection).
 */
export const twoInletFlowCell: Schematic = {
  version: 1,
  name: 'Two-inlet flow cell',
  components: [
    { id: 'resA', kind: 'reservoir', name: 'Reservoir A', pos: { x: 100, y: 300 }, rotation: 0, liquid: 'Buffer', color: '#16a34a' },
    { id: 'v1', kind: 'valve', name: 'Valve 1', pos: { x: 220, y: 190 }, rotation: 0, initialOpen: true },
    { id: 'p1', kind: 'pump', name: 'Pump 1', pos: { x: 150, y: 80 }, rotation: 0, syringeVolume_uL: 500, initialFill_uL: 400, initialColor: '#dc2626' },
    { id: 'fc1', kind: 'flowcell', name: 'Flow cell', pos: { x: 400, y: 200 }, rotation: 0, inlets: 2, outlets: 1, volume_uL: 20 },
    { id: 'j1', kind: 'junction', name: 'J1', pos: { x: 520, y: 200 }, rotation: 0 },
    { id: 'p2', kind: 'pump', name: 'Pump 2', pos: { x: 650, y: 200 }, rotation: 180, syringeVolume_uL: 1000, initialFill_uL: 0, initialColor: '#ffffff' },
    { id: 'v2', kind: 'valve', name: 'Valve 2', pos: { x: 520, y: 290 }, rotation: 90, initialOpen: false },
    { id: 'w1', kind: 'waste', name: 'Waste', pos: { x: 520, y: 380 }, rotation: 0 },
  ],
  pipes: [
    { id: 'pipe1', from: { comp: 'resA', port: 'p' }, to: { comp: 'v1', port: 'a' }, waypoints: [{ x: 100, y: 190 }], width_mm: 0.3, depth_mm: 0.35 },
    { id: 'pipe2', from: { comp: 'v1', port: 'b' }, to: { comp: 'fc1', port: 'in0' }, waypoints: [], width_mm: 0.3, depth_mm: 0.35 },
    {
      id: 'pipe3',
      from: { comp: 'p1', port: 'out' },
      to: { comp: 'fc1', port: 'in1' },
      waypoints: [
        { x: 300, y: 80 },
        { x: 300, y: 210 },
      ],
      width_mm: 0.3, depth_mm: 0.35,
    },
    { id: 'pipe4', from: { comp: 'fc1', port: 'out0' }, to: { comp: 'j1', port: 'j' }, waypoints: [], width_mm: 0.3, depth_mm: 0.35 },
    { id: 'pipe5', from: { comp: 'j1', port: 'j' }, to: { comp: 'p2', port: 'out' }, waypoints: [], width_mm: 0.3, depth_mm: 0.35 },
    { id: 'pipe6', from: { comp: 'j1', port: 'j' }, to: { comp: 'v2', port: 'a' }, waypoints: [], width_mm: 0.3, depth_mm: 0.35 },
    { id: 'pipe7', from: { comp: 'v2', port: 'b' }, to: { comp: 'w1', port: 'p' }, waypoints: [], width_mm: 0.3, depth_mm: 0.35 },
  ],
};

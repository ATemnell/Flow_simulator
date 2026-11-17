import { create } from 'zustand';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { SCHEMATIC_VERSION, type Schematic } from '../model/types';

interface AppState {
  schematic: Schematic;
  error: string | null;
  setSchematic: (s: Schematic) => void;
  setError: (e: string | null) => void;
}

export const emptySchematic = (): Schematic => ({ version: SCHEMATIC_VERSION, name: 'Untitled', components: [], pipes: [] });

export const useApp = create<AppState>((set) => ({
  schematic: twoInletFlowCell,
  error: null,
  setSchematic: (schematic) => set({ schematic, error: null }),
  setError: (error) => set({ error }),
}));

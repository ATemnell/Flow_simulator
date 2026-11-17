/** Core data model for a fluidic schematic. World units are millimetres. */

export const SCHEMATIC_VERSION = 1;

export interface Vec {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export type ComponentKind = 'pump' | 'valve' | 'flowcell' | 'reservoir' | 'waste' | 'junction';

interface BaseComponent {
  id: string;
  /** User-visible name; also the CSV column header used by scripts. */
  name: string;
  pos: Vec;
  rotation: Rotation;
}

/** Syringe pump. Positive flow = dispense (out of the port), negative = aspirate. */
export interface Pump extends BaseComponent {
  kind: 'pump';
  syringeVolume_uL: number;
  /** Liquid in the barrel at t=0. */
  initialFill_uL: number;
  initialColor: string;
}

/** On/off valve with two ports. */
export interface Valve extends BaseComponent {
  kind: 'valve';
  initialOpen: boolean;
}

/** Chamber with n inlets (left side) and m outlets (right side). */
export interface FlowCell extends BaseComponent {
  kind: 'flowcell';
  inlets: number;
  outlets: number;
  /** Internal chamber volume. */
  volume_uL: number;
}

/** Open liquid source. Name/color can be changed by the script. */
export interface Reservoir extends BaseComponent {
  kind: 'reservoir';
  liquid: string;
  color: string;
}

/** Open sink — liquid leaving here disappears from the system. */
export interface Waste extends BaseComponent {
  kind: 'waste';
}

/** Explicit connection point where 2+ pipes meet (a T-junction). */
export interface Junction extends BaseComponent {
  kind: 'junction';
}

export type Component = Pump | Valve | FlowCell | Reservoir | Waste | Junction;

export interface PortRef {
  comp: string;
  port: string;
}

/** A pipe end that is not connected to anything yet (drawn with an ×). */
export interface FreeEnd {
  free: Vec;
}

export type PipeEnd = PortRef | FreeEnd;

export const isFree = (e: PipeEnd): e is FreeEnd => 'free' in e;

/** The component a pipe end is attached to, or null for an open end. */
export const endComp = (e: PipeEnd): string | null => (isFree(e) ? null : e.comp);

/** A pipe: polyline from one port to another through optional waypoints. */
export interface Pipe {
  id: string;
  from: PipeEnd;
  to: PipeEnd;
  waypoints: Vec[];
  /** Rectangular channel cross-section. */
  width_mm: number;
  depth_mm: number;
}

export interface Schematic {
  version: number;
  name: string;
  components: Component[];
  pipes: Pipe[];
}

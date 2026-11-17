/** Units used when reading a script. Internally everything is µL, µL/min and seconds. */
export interface ScriptUnits {
  volume: 'uL' | 'mL';
  flow: 'uL/min' | 'uL/s' | 'mL/min';
  time: 's' | 'min';
}

export const DEFAULT_UNITS: ScriptUnits = { volume: 'uL', flow: 'uL/min', time: 's' };

export const VOLUME_UNITS: { value: ScriptUnits['volume']; label: string; toUL: number }[] = [
  { value: 'uL', label: 'µL', toUL: 1 },
  { value: 'mL', label: 'mL', toUL: 1000 },
];

export const FLOW_UNITS: { value: ScriptUnits['flow']; label: string; toULperMin: number }[] = [
  { value: 'uL/min', label: 'µL/min', toULperMin: 1 },
  { value: 'uL/s', label: 'µL/s', toULperMin: 60 },
  { value: 'mL/min', label: 'mL/min', toULperMin: 1000 },
];

export const TIME_UNITS: { value: ScriptUnits['time']; label: string; toS: number }[] = [
  { value: 's', label: 's', toS: 1 },
  { value: 'min', label: 'min', toS: 60 },
];

export const volumeFactor = (u: ScriptUnits) => VOLUME_UNITS.find((x) => x.value === u.volume)!.toUL;
export const flowFactor = (u: ScriptUnits) => FLOW_UNITS.find((x) => x.value === u.flow)!.toULperMin;
export const timeFactor = (u: ScriptUnits) => TIME_UNITS.find((x) => x.value === u.time)!.toS;
export const volumeLabel = (u: ScriptUnits) => VOLUME_UNITS.find((x) => x.value === u.volume)!.label;
export const flowLabel = (u: ScriptUnits) => FLOW_UNITS.find((x) => x.value === u.flow)!.label;

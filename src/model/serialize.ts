import { localPorts } from './geometry';
import { SCHEMATIC_VERSION, type Component, type Schematic } from './types';
import { DEFAULT_UNITS, type ScriptUnits } from '../script/units';

/** A saved file: the schematic plus (optionally) its CSV script. */
export interface DocumentScript {
  text: string;
  units: ScriptUnits;
}

export function serializeDocument(s: Schematic, script?: DocumentScript): string {
  return JSON.stringify({ ...s, version: SCHEMATIC_VERSION, ...(script && script.text.trim() ? { script } : {}) }, null, 2);
}

export function parseDocument(json: string): { schematic: Schematic; script?: DocumentScript } {
  const schematic = parseSchematic(json);
  const raw = JSON.parse(json);
  const sc = raw.script;
  if (sc && typeof sc.text === 'string') return { schematic, script: { text: sc.text, units: { ...DEFAULT_UNITS, ...(sc.units ?? {}) } } };
  return { schematic };
}

export function serializeSchematic(s: Schematic): string {
  return JSON.stringify({ ...s, version: SCHEMATIC_VERSION }, null, 2);
}

const KINDS = new Set(['pump', 'valve', 'flowcell', 'reservoir', 'waste', 'junction']);

/** Parse and validate a schematic JSON string. Throws an Error with a readable message on problems. */
export function parseSchematic(json: string): Schematic {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('Schematic must be a JSON object');
  if (raw.version !== SCHEMATIC_VERSION) throw new Error(`Unsupported schematic version ${raw.version}`);
  if (!Array.isArray(raw.components) || !Array.isArray(raw.pipes)) throw new Error('Schematic needs "components" and "pipes" arrays');

  const s: Schematic = { version: raw.version, name: String(raw.name ?? 'Untitled'), components: raw.components, pipes: raw.pipes };
  const problems = validateSchematic(s);
  if (problems.length) throw new Error(problems.join('\n'));
  return s;
}

/** Structural checks: unique ids/names, known kinds, pipes referencing existing ports. */
export function validateSchematic(s: Schematic): string[] {
  const problems: string[] = [];
  const byId = new Map<string, Component>();
  const names = new Set<string>();
  for (const c of s.components) {
    if (!KINDS.has(c.kind)) problems.push(`Component '${c.id}' has unknown kind '${(c as any).kind}'`);
    if (byId.has(c.id)) problems.push(`Duplicate component id '${c.id}'`);
    if (c.kind !== 'junction') {
      if (names.has(c.name)) problems.push(`Duplicate component name '${c.name}'`);
      names.add(c.name);
    }
    byId.set(c.id, c);
  }
  const used = new Map<string, string>();
  const pipeIds = new Set<string>();
  for (const p of s.pipes) {
    if (pipeIds.has(p.id)) problems.push(`Duplicate pipe id '${p.id}'`);
    pipeIds.add(p.id);
    if (!(p.innerDiameter_mm > 0)) problems.push(`Pipe '${p.id}' needs a positive inner diameter`);
    for (const end of [p.from, p.to]) {
      const c = byId.get(end.comp);
      if (!c) {
        problems.push(`Pipe '${p.id}' references unknown component '${end.comp}'`);
        continue;
      }
      if (!KINDS.has(c.kind)) continue;
      if (!localPorts(c).some((lp) => lp.id === end.port)) {
        problems.push(`Pipe '${p.id}' references unknown port '${end.port}' on '${c.name}'`);
        continue;
      }
      // Only junctions accept more than one pipe per port.
      if (c.kind !== 'junction') {
        const key = `${end.comp}:${end.port}`;
        const other = used.get(key);
        if (other) problems.push(`Port '${end.port}' on '${c.name}' is used by both '${other}' and '${p.id}'`);
        used.set(key, p.id);
      }
    }
  }
  return problems;
}

/**
 * CSV script → timeline.
 *
 *   # comment
 *   Pump 1, Pump 2, Valve 1, Reservoir A      ← header: part names (case-insensitive)
 *   fill 400 red, fill 0, 1, Buffer green      ← set syringe contents / valve / reservoir liquid
 *   100 10, -100 -10, 0,                       ← pumps: volume flow (negative = aspirate)
 *   Wait 2                                     ← pause (seconds by default; "Wait 1.5 min")
 *   50 10, 0 0, 1, Sample #2563eb
 *
 * Every pump in a row starts together and runs for |volume| / |flow|. The next row starts when the
 * slowest pump of the row has finished. Empty cells: pump idle, valve and reservoir unchanged.
 * The separator may be ',', ';' or a tab (with ';' or tab, a decimal comma is allowed).
 */
import type { Component, Pump, Schematic } from '../model/types';
import { parseColor } from './colors';
import { flowFactor, flowLabel, timeFactor, volumeFactor, volumeLabel, type ScriptUnits } from './units';

export type Action =
  /** Run a pump: flow in µL/min (negative = aspirate) for `volume` µL. */
  | { type: 'pump'; id: string; flow: number; volume: number }
  | { type: 'stop'; id: string }
  | { type: 'valve'; id: string; open: boolean }
  | { type: 'reservoir'; id: string; color: string; liquid?: string }
  | { type: 'fill'; id: string; vol: number; color?: string };

export interface Step {
  /** 1-based line in the script. */
  line: number;
  kind: 'row' | 'wait';
  /** Seconds from the start of the script. */
  start: number;
  duration: number;
  actions: Action[];
  source: string;
}

export interface Problem {
  line: number;
  column?: string;
  message: string;
}

export interface ScriptColumn {
  name: string;
  /** Position of this column in the CSV (invalid header columns keep their place). */
  pos: number;
  id: string;
  kind: 'pump' | 'valve' | 'reservoir';
}

export interface CompiledScript {
  columns: ScriptColumn[];
  steps: Step[];
  duration: number;
  errors: Problem[];
  warnings: Problem[];
}

/** Split one CSV line (supports "quoted, cells"). */
export function splitCsvLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function detectSeparator(header: string): string {
  if (header.includes('\t')) return '\t';
  if (header.includes(';') && !header.includes(',')) return ';';
  return ',';
}

const fmt = (x: number) => String(Math.round(x * 1000) / 1000);

export function compileScript(text: string, s: Schematic, units: ScriptUnits): CompiledScript {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const steps: Step[] = [];
  const columns: ScriptColumn[] = [];
  const vf = volumeFactor(units);
  const ff = flowFactor(units);
  const tf = timeFactor(units);

  const lines = text.split(/\r?\n/);
  let sep = ',';
  let headerSeen = false;
  let headerWidth = 0;
  let t = 0;
  // Nominal syringe fill, to warn about running empty or overfilling.
  const fill = new Map<string, number>();
  for (const c of s.components) if (c.kind === 'pump') fill.set(c.id, c.initialFill_uL);
  const byId = new Map(s.components.map((c) => [c.id, c]));

  const num = (tok: string): number | null => {
    const v = sep === ',' ? tok : tok.replace(',', '.');
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v) ? Number(v) : null;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (!headerSeen) {
      sep = detectSeparator(raw);
      headerSeen = true;
      const names = splitCsvLine(raw, sep);
      while (names.length && !names[names.length - 1]) names.pop();
      headerWidth = names.length;
      const seen = new Set<string>();
      for (const [pos, name] of names.entries()) {
        if (!name) {
          errors.push({ line: lineNo, message: 'Empty column name in the header.' });
          continue;
        }
        const c = s.components.find((k) => k.kind !== 'junction' && k.name.toLowerCase() === name.toLowerCase());
        if (!c) {
          const known = s.components.filter((k) => k.kind === 'pump' || k.kind === 'valve' || k.kind === 'reservoir').map((k) => k.name);
          errors.push({ line: lineNo, column: name, message: `No part named '${name}'. Controllable parts: ${known.join(', ') || 'none'}.` });
          continue;
        }
        if (c.kind !== 'pump' && c.kind !== 'valve' && c.kind !== 'reservoir') {
          errors.push({ line: lineNo, column: name, message: `'${c.name}' (${c.kind === 'flowcell' ? 'flow cell' : c.kind}) has nothing to control; remove this column.` });
          continue;
        }
        if (seen.has(c.id)) errors.push({ line: lineNo, column: name, message: `'${c.name}' appears twice in the header.` });
        seen.add(c.id);
        columns.push({ name: c.name, pos, id: c.id, kind: c.kind });
      }
      continue;
    }

    const cells = splitCsvLine(raw, sep);
    if (cells.every((c) => !c)) continue;

    // Wait line
    const first = cells[0].trim();
    const wm = /^wait\b\s*(.*)$/i.exec(first);
    if (wm) {
      if (cells.slice(1).some((c) => c)) errors.push({ line: lineNo, message: 'A Wait line cannot have other cells.' });
      const parts = wm[1].trim().split(/\s+/).filter(Boolean);
      const n = parts.length ? num(parts[0]) : null;
      const unit = (parts[1] ?? '').toLowerCase();
      const unitFactor = unit === '' ? tf : ['s', 'sec', 'second', 'seconds'].includes(unit) ? 1 : ['min', 'mins', 'minute', 'minutes'].includes(unit) ? 60 : null;
      if (n === null || n < 0 || unitFactor === null || parts.length > 2) {
        errors.push({ line: lineNo, message: `Write a wait as 'Wait 2' or 'Wait 1.5 min'.` });
        continue;
      }
      const d = n * unitFactor;
      steps.push({ line: lineNo, kind: 'wait', start: t, duration: d, actions: [], source: trimmed });
      t += d;
      continue;
    }

    if (cells.length > headerWidth && cells.slice(headerWidth).some((c) => c)) {
      errors.push({ line: lineNo, message: `This row has ${cells.filter(Boolean).length} values but the header has ${headerWidth} columns.` });
    }

    const actions: Action[] = [];
    let duration = 0;
    columns.forEach((col) => {
      const cell = (cells[col.pos] ?? '').trim();
      const comp = byId.get(col.id) as Component;
      const err = (message: string) => errors.push({ line: lineNo, column: col.name, message: `${col.name}: ${message}` });
      const tokens = cell.split(/\s+/).filter(Boolean);

      if (col.kind === 'pump') {
        const pump = comp as Pump;
        if (!cell || /^(stop|idle)$/i.test(cell)) {
          actions.push({ type: 'stop', id: col.id });
          return;
        }
        if (tokens[0].toLowerCase() === 'fill') {
          const v = tokens[1] !== undefined ? num(tokens[1]) : null;
          const color = tokens[2] !== undefined ? parseColor(tokens[2]) : undefined;
          if (v === null || v < 0 || tokens.length > 3) return err(`write a fill as 'fill 400' or 'fill 400 red' (volume in ${volumeLabel(units)}).`);
          if (color === null) return err(`'${tokens[2]}' is not a colour (use a name like red or a code like #dc2626).`);
          const vol = v * vf;
          if (vol > pump.syringeVolume_uL + 1e-9) return err(`fill ${fmt(vol)} µL is more than the ${pump.syringeVolume_uL} µL syringe holds.`);
          actions.push({ type: 'fill', id: col.id, vol, color: color ?? undefined });
          actions.push({ type: 'stop', id: col.id });
          fill.set(col.id, vol);
          return;
        }
        const nums = tokens.map(num);
        if (nums.some((x) => x === null) || tokens.length > 2) return err(`expected 'volume flow', e.g. '100 10' or '-100 -10' to aspirate.`);
        const [v, f] = nums as number[];
        if (tokens.length === 1) {
          if (v === 0) return actions.push({ type: 'stop', id: col.id }), undefined;
          return err(`expected 'volume flow', e.g. '${tokens[0]} 10'.`);
        }
        if (v === 0 && f === 0) return actions.push({ type: 'stop', id: col.id }), undefined;
        if (v === 0 || f === 0) return err('volume and flow must both be non-zero (use 0 0 to stop).');
        if (v < 0 !== f < 0) return err(`volume and flow have different signs; use '-${fmt(Math.abs(v))} -${fmt(Math.abs(f))}' to aspirate or '${fmt(Math.abs(v))} ${fmt(Math.abs(f))}' to dispense.`);
        const volume = Math.abs(v) * vf;
        const flow = Math.sign(v) * Math.abs(f) * ff; // µL/min, negative = aspirate
        actions.push({ type: 'pump', id: col.id, flow, volume });
        duration = Math.max(duration, (volume / Math.abs(flow)) * 60);
        // Syringe bookkeeping (nominal; the simulation stops the pump at the real limit).
        const before = fill.get(col.id) ?? 0;
        const after = before - Math.sign(flow) * volume;
        if (after < -1e-9) warnings.push({ line: lineNo, column: col.name, message: `${col.name} dispenses ${fmt(volume)} µL but only ${fmt(before)} µL is in the syringe; it will stop early.` });
        if (after > pump.syringeVolume_uL + 1e-9)
          warnings.push({ line: lineNo, column: col.name, message: `${col.name} aspirates ${fmt(volume)} µL but only ${fmt(pump.syringeVolume_uL - before)} µL fits in the syringe; it will stop early.` });
        fill.set(col.id, Math.min(pump.syringeVolume_uL, Math.max(0, after)));
        return;
      }

      if (!cell) return;

      if (col.kind === 'valve') {
        const v = cell.toLowerCase();
        if (['1', 'open', 'on'].includes(v)) actions.push({ type: 'valve', id: col.id, open: true });
        else if (['0', 'closed', 'close', 'off'].includes(v)) actions.push({ type: 'valve', id: col.id, open: false });
        else err(`use 1 (open) or 0 (closed), not '${cell}'.`);
        return;
      }

      // Reservoir: "[liquid name] colour"
      const color = parseColor(tokens[tokens.length - 1]);
      if (!color) return err(`end the cell with a colour, e.g. 'red', '#2563eb' or 'Sample blue' ('${tokens[tokens.length - 1]}' is not a colour).`);
      const liquid = tokens.slice(0, -1).join(' ');
      actions.push({ type: 'reservoir', id: col.id, color, liquid: liquid || undefined });
    });

    steps.push({ line: lineNo, kind: 'row', start: t, duration, actions, source: trimmed });
    t += duration;
  }

  if (!headerSeen && text.trim()) errors.push({ line: 1, message: 'The script needs a header row with part names.' });
  return { columns, steps, duration: t, errors, warnings };
}

/** Human-readable flow for display, in the script's units. */
export function describeFlow(flow_uL_min: number, units: ScriptUnits): string {
  return `${fmt(flow_uL_min / flowFactor(units))} ${flowLabel(units)}`;
}

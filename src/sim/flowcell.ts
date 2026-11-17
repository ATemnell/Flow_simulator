/**
 * Flow cell transport: laminar co-flow.
 *
 * Liquid entering through several inlets does not mix; each stream occupies a band of the chamber
 * cross-section whose width is proportional to its flow (q_i / Σq). The chamber content is a list of
 * "slabs" ordered from the inlet side (left) to the outlet side (right); each slab is a cross-section
 * profile (bands, top to bottom) over some volume. Slabs advance through the chamber like plugs in a
 * pipe. At the far side, outlets take consecutive slices of the cross-section (outlet 1 the top slice,
 * and so on), each slice as wide as that outlet's share of the outflow.
 */
import type { FlowCell } from '../model/types';
import { blend, EMPTY, similar } from './color';
import type { Plug } from './transport';

export interface Band {
  color: string;
  /** Fraction of the cross-section width (top to bottom); a slab's bands sum to 1. */
  frac: number;
}

export interface Slab {
  bands: Band[];
  vol: number;
}

/** The flow cell has no parameters, so the chamber gets a fixed nominal volume. */
export const FLOWCELL_VOLUME_uL = 20;

const TINY = 1e-9;
const MAX_SLABS = 300;

export function initialChamber(): Slab[] {
  return [{ bands: [{ color: EMPTY, frac: 1 }], vol: FLOWCELL_VOLUME_uL }];
}

export interface PortIn {
  port: string;
  seq: Plug[]; // exit order from the upstream pipe = arrival order
}
export interface PortOut {
  port: string;
  vol: number;
}

const side = (port: string) => (port.startsWith('in') ? 'L' : 'R');
const portIndex = (port: string) => Number(port.replace(/\D+/g, ''));
const byIndex = <T extends { port: string }>(a: T, b: T) => portIndex(a.port) - portIndex(b.port);
const seqVol = (seq: Plug[]) => seq.reduce((a, p) => a + p.vol, 0);

/**
 * Several simultaneous streams → slabs in arrival order. Within one step each stream may carry a
 * colour change (a front arriving); the step is split at every such boundary so fronts stay sharp.
 */
export function streamsToSlabs(seqs: Plug[][]): Slab[] {
  const totals = seqs.map(seqVol);
  const sum = totals.reduce((a, b) => a + b, 0);
  if (sum <= TINY) return [];
  const cuts = new Set<number>([0, 1]);
  seqs.forEach((seq, i) => {
    let acc = 0;
    for (const p of seq) {
      acc += p.vol;
      if (totals[i] > 0) cuts.add(Math.min(1, acc / totals[i]));
    }
  });
  const ts = [...cuts].sort((a, b) => a - b);
  const slabs: Slab[] = [];
  for (let k = 0; k < ts.length - 1; k++) {
    const a = ts[k];
    const b = ts[k + 1];
    if (b - a <= TINY) continue;
    const mid = (a + b) / 2;
    const bands: Band[] = [];
    seqs.forEach((seq, i) => {
      if (totals[i] <= TINY) return;
      let acc = 0;
      let color = EMPTY;
      for (const p of seq) {
        acc += p.vol;
        color = p.color;
        if (acc / totals[i] >= mid) break;
      }
      bands.push({ color, frac: totals[i] / sum });
    });
    slabs.push({ bands, vol: (b - a) * sum });
  }
  return slabs;
}

/** Colour of the cross-section slice [a, b] (fractions, top to bottom), blending bands it overlaps. */
export function sliceColor(bands: Band[], a: number, b: number): string {
  const parts: { color: string; vol: number }[] = [];
  let c = 0;
  for (const band of bands) {
    const lo = Math.max(a, c);
    const hi = Math.min(b, c + band.frac);
    if (hi > lo) parts.push({ color: band.color, vol: hi - lo });
    c += band.frac;
  }
  if (parts.length === 1) return parts[0].color;
  return blend(parts);
}

function takeSlabs(slabs: Slab[], v: number, fromEnd: boolean): Slab[] {
  const out: Slab[] = [];
  while (v > TINY && slabs.length) {
    const s = fromEnd ? slabs[slabs.length - 1] : slabs[0];
    if (s.vol <= v + TINY) {
      out.push(fromEnd ? slabs.pop()! : slabs.shift()!);
      v -= s.vol;
    } else {
      out.push({ bands: s.bands, vol: v });
      s.vol -= v;
      v = 0;
    }
  }
  if (v > TINY) out.push({ bands: [{ color: EMPTY, frac: 1 }], vol: v });
  return out;
}

function sameProfile(a: Slab, b: Slab): boolean {
  if (a.bands.length !== b.bands.length) return false;
  return a.bands.every((x, i) => similar(x.color, b.bands[i].color) && Math.abs(x.frac - b.bands[i].frac) < 0.005);
}

export function compactSlabs(slabs: Slab[]): Slab[] {
  const out: Slab[] = [];
  for (const s of slabs) {
    if (s.vol <= TINY) continue;
    const last = out[out.length - 1];
    if (last && sameProfile(last, s)) out[out.length - 1] = { bands: last.bands, vol: last.vol + s.vol };
    else out.push({ bands: s.bands, vol: s.vol });
  }
  while (out.length > MAX_SLABS) {
    // Drop the thinnest slab into its neighbour.
    let k = 0;
    for (let i = 1; i < out.length; i++) if (out[i].vol < out[k].vol) k = i;
    const n = k > 0 ? k - 1 : 1;
    out[n] = { bands: out[n].bands, vol: out[n].vol + out[k].vol };
    out.splice(k, 1);
  }
  return out;
}

/** Single stream passes its sequence through; several streams are blended. Scaled to `vol`. */
function bypass(ins: PortIn[], vol: number): Plug[] {
  const all = ins.flatMap((i) => i.seq);
  const tot = seqVol(all);
  if (vol <= TINY) return [];
  if (tot <= TINY) return [{ color: EMPTY, vol }];
  if (ins.length === 1) return all.map((p) => ({ color: p.color, vol: (p.vol * vol) / tot }));
  return [{ color: blend(all), vol }];
}

/**
 * One transport step for a flow cell. `ins` are the streams arriving at its ports, `outs` the volumes
 * leaving through ports. Returns the new chamber content and the sequence leaving through each port.
 */
export function advanceFlowCell(_fc: FlowCell, chamber: Slab[], ins: PortIn[], outs: PortOut[]): { chamber: Slab[]; outSeqs: Map<string, Plug[]> } {
  const inL = ins.filter((i) => side(i.port) === 'L').sort(byIndex);
  const inR = ins.filter((i) => side(i.port) === 'R').sort(byIndex);
  const outL = outs.filter((o) => side(o.port) === 'L').sort(byIndex);
  const outR = outs.filter((o) => side(o.port) === 'R').sort(byIndex);
  const vInL = inL.reduce((a, i) => a + seqVol(i.seq), 0);
  const vInR = inR.reduce((a, i) => a + seqVol(i.seq), 0);
  const vOutL = outL.reduce((a, o) => a + o.vol, 0);
  const vOutR = outR.reduce((a, o) => a + o.vol, 0);
  const through = vInL - vOutL; // > 0: liquid crosses left → right

  const outSeqs = new Map<string, Plug[]>();
  let slabs = chamber;

  const cross = (entryIns: PortIn[], vIn: number, exitOuts: PortOut[], vOut: number, otherIns: PortIn[], vOther: number, forward: boolean, q: number) => {
    // Part of each entering stream crosses the chamber; the rest leaves again on the entry side.
    const scale = q / vIn;
    const entering = streamsToSlabs(entryIns.map((i) => i.seq.map((p) => ({ color: p.color, vol: p.vol * scale }))));
    // Liquid that entered first ends up furthest in.
    slabs = forward ? [...[...entering].reverse(), ...slabs] : [...slabs, ...entering];
    const exiting = takeSlabs(slabs, q, forward);
    // Exit side: outlets take consecutive slices of the cross-section.
    let a = 0;
    for (const o of exitOuts) {
      const share = o.vol / vOut;
      const b = a + share;
      const seq: Plug[] = exiting.map((s) => ({ color: sliceColor(s.bands, a, b), vol: (s.vol * o.vol) / vOut }));
      // Streams entering on the exit side (rare) join their outlet directly.
      if (vOther > TINY) seq.push(...bypass(otherIns, (vOther * o.vol) / vOut));
      outSeqs.set(o.port, seq);
      a = b;
    }
  };

  if (through > TINY) {
    cross(inL, vInL, outR, vOutR, inR, vInR, true, through);
    for (const o of outL) outSeqs.set(o.port, bypass(inL, o.vol));
  } else if (through < -TINY) {
    cross(inR, vInR, outL, vOutL, inL, vInL, false, -through);
    for (const o of outR) outSeqs.set(o.port, bypass(inR, o.vol));
  } else {
    // Nothing crosses: whatever comes in on a side leaves on the same side.
    for (const o of outL) outSeqs.set(o.port, bypass(inL, o.vol));
    for (const o of outR) outSeqs.set(o.port, bypass(inR, o.vol));
  }
  return { chamber: compactSlabs(slabs), outSeqs };
}

/** Net flow (µL/min) crossing the chamber left → right, from the solver's port flows. */
export function throughFlow(fcId: string, inlets: number, portFlow: Map<string, number>): number {
  let q = 0;
  for (let i = 0; i < inlets; i++) q += portFlow.get(`${fcId}:in${i}`) ?? 0;
  return q;
}

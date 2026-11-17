/**
 * Flow network solver.
 *
 * Syringe pumps impose flow rates; reservoirs and waste are open to atmosphere (pressure 0).
 * Liquid is incompressible, so at every node inflow = outflow (Kirchhoff's current law).
 * Where liquid can take several routes, it splits according to hydraulic conductance of the
 * rectangular channels, G ∝ a³·b·(1 − 0.63·a/b) / L (viscosity is the same everywhere and
 * cancels out, so pressures here are relative, not in pascals).
 *
 * Units: flows in µL/min. A pipe's flow is positive when liquid moves from its `from` end to its `to` end.
 */
import { channelConductance, localPorts, pipeLength_mm } from '../model/geometry';
import { isFree, type PipeEnd, type Schematic } from '../model/types';

/** The controllable state at one instant. Missing entries mean pump idle / valve at its initial state. */
export interface FlowInputs {
  /** µL/min per pump id. Positive = dispense (out of the syringe), negative = aspirate. */
  pumpFlow: Record<string, number>;
  valveOpen: Record<string, boolean>;
}

export interface FlowIssue {
  message: string;
  /** Component ids involved, for highlighting. */
  components: string[];
}

export interface FlowSolution {
  /** µL/min per pipe id, positive in the from→to direction. */
  pipeFlow: Map<string, number>;
  /** µL/min per `${comp}:${port}`, positive = liquid flowing INTO the component through that port. */
  portFlow: Map<string, number>;
  /** Relative pressure per node key (for diagnostics). */
  pressure: Map<string, number>;
  /** Sections of the network that cannot be solved (e.g. a pump pushing against a closed valve). Their flows are 0. */
  issues: FlowIssue[];
}

/** Conductance of the short internal path through an open valve or across a flow cell chamber
 * (≈ a default 0.3 × 0.35 mm channel only 0.36 mm long, i.e. negligible next to real channels). */
const INTERNAL_G = 1e-3;
const MIN_LENGTH_MM = 1e-3;

export function defaultInputs(s: Schematic): FlowInputs {
  const valveOpen: Record<string, boolean> = {};
  for (const c of s.components) if (c.kind === 'valve') valveOpen[c.id] = c.initialOpen;
  return { pumpFlow: {}, valveOpen };
}

interface Edge {
  a: string;
  b: string;
  g: number;
  pipeId?: string;
}

const key = (comp: string, port: string) => `${comp}:${port}`;
const chamberKey = (comp: string) => `${comp}:#chamber`;

export function solveFlows(s: Schematic, inputs: FlowInputs): FlowSolution {
  const nodes = new Set<string>();
  const edges: Edge[] = [];
  const fixed = new Set<string>(); // pressure = 0
  const injection = new Map<string, number>(); // µL/min into the network at a node

  for (const c of s.components) {
    for (const p of localPorts(c)) nodes.add(key(c.id, p.id));
    switch (c.kind) {
      case 'reservoir':
      case 'waste':
        fixed.add(key(c.id, 'p'));
        break;
      case 'pump': {
        const q = inputs.pumpFlow[c.id] ?? 0;
        if (q !== 0) injection.set(key(c.id, 'out'), q);
        break;
      }
      case 'valve': {
        const open = inputs.valveOpen[c.id] ?? c.initialOpen;
        if (open) edges.push({ a: key(c.id, 'a'), b: key(c.id, 'b'), g: INTERNAL_G });
        break;
      }
      case 'flowcell': {
        const ch = chamberKey(c.id);
        nodes.add(ch);
        for (const p of localPorts(c)) edges.push({ a: key(c.id, p.id), b: ch, g: INTERNAL_G });
        break;
      }
    }
  }

  for (const p of s.pipes) {
    let len: number;
    try {
      len = pipeLength_mm(s, p);
    } catch {
      continue; // dangling pipe — validation reports it
    }
    // An open (unconnected) pipe end is its own node with nothing else attached: a sealed dead end.
    const endKey = (e: PipeEnd, which: string) => {
      if (!isFree(e)) return key(e.comp, e.port);
      const k = `#open:${p.id}:${which}`;
      nodes.add(k);
      return k;
    };
    edges.push({ a: endKey(p.from, 'from'), b: endKey(p.to, 'to'), g: channelConductance(p.width_mm, p.depth_mm, Math.max(len, MIN_LENGTH_MM)), pipeId: p.id });
  }

  // Connected sections (union–find).
  const parent = new Map<string, string>([...nodes].map((n) => [n, n]));
  const find = (n: string): string => {
    let r = n;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(n, r);
    return r;
  };
  for (const e of edges) {
    if (!nodes.has(e.a) || !nodes.has(e.b)) continue;
    parent.set(find(e.a), find(e.b));
  }
  const sections = new Map<string, string[]>();
  for (const n of nodes) {
    const r = find(n);
    if (!sections.has(r)) sections.set(r, []);
    sections.get(r)!.push(n);
  }

  const pressure = new Map<string, number>();
  const issues: FlowIssue[] = [];
  const compOf = (n: string) => n.slice(0, n.indexOf(':'));
  const byId = new Map(s.components.map((c) => [c.id, c]));

  for (const members of sections.values()) {
    const net = members.reduce((acc, n) => acc + (injection.get(n) ?? 0), 0);
    const anchors = members.filter((n) => fixed.has(n));
    const maxInj = Math.max(0, ...members.map((n) => Math.abs(injection.get(n) ?? 0)));

    if (anchors.length === 0) {
      // Closed section: incompressible liquid can only move if pumps balance exactly.
      if (Math.abs(net) > 1e-9 * Math.max(1, maxInj)) {
        issues.push(closedSectionIssue(members, net, injection, byId, inputs, compOf));
        for (const n of members) pressure.set(n, NaN);
        continue;
      }
      anchors.push(members[0]); // pressure is only defined up to a constant: pin one node
    }

    const unknown = members.filter((n) => !anchors.includes(n));
    for (const n of anchors) pressure.set(n, 0);
    if (unknown.length === 0) continue;
    const idx = new Map(unknown.map((n, i) => [n, i]));
    const N = unknown.length;
    const A = Array.from({ length: N }, () => new Float64Array(N));
    const b = new Float64Array(N);
    for (const n of unknown) b[idx.get(n)!] = injection.get(n) ?? 0;
    for (const e of edges) {
      const ia = idx.get(e.a);
      const ib = idx.get(e.b);
      if (ia === undefined && ib === undefined) continue;
      // Σ G (p_i − p_j) = injection_i ; anchored neighbours have p = 0.
      if (ia !== undefined) A[ia][ia] += e.g;
      if (ib !== undefined) A[ib][ib] += e.g;
      if (ia !== undefined && ib !== undefined) {
        A[ia][ib] -= e.g;
        A[ib][ia] -= e.g;
      }
    }
    const x = solveDense(A, b);
    unknown.forEach((n, i) => pressure.set(n, x[i]));
  }

  const pipeFlow = new Map<string, number>();
  const portFlow = new Map<string, number>();
  const addPort = (k: string, q: number) => portFlow.set(k, (portFlow.get(k) ?? 0) + q);
  for (const e of edges) {
    if (!e.pipeId) continue;
    const pa = pressure.get(e.a);
    const pb = pressure.get(e.b);
    let q = pa === undefined || pb === undefined || Number.isNaN(pa) || Number.isNaN(pb) ? 0 : e.g * (pa - pb);
    if (Math.abs(q) < 1e-9) q = 0;
    pipeFlow.set(e.pipeId, q);
    addPort(e.a, -q); // leaves the `from` component
    addPort(e.b, q); // enters the `to` component
  }
  return { pipeFlow, portFlow, pressure, issues };
}

function closedSectionIssue(
  members: string[],
  net: number,
  injection: Map<string, number>,
  byId: Map<string, Schematic['components'][number]>,
  inputs: FlowInputs,
  compOf: (n: string) => string,
): FlowIssue {
  const pumps = [...new Set(members.filter((n) => injection.has(n)).map(compOf))];
  const pumpNames = pumps.map((id) => byId.get(id)?.name ?? id);
  const closedValves = [...new Set(members.map(compOf))].filter((id) => {
    const c = byId.get(id);
    return c?.kind === 'valve' && !(inputs.valveOpen[id] ?? c.initialOpen);
  });
  if (members.length === 1) {
    return { message: `${pumpNames[0]} is running but not connected to anything.`, components: pumps };
  }
  const verb = net > 0 ? 'push' : 'pull';
  const list = pumpNames.length > 1 ? `${pumpNames.slice(0, -1).join(', ')} and ${pumpNames[pumpNames.length - 1]}` : pumpNames[0];
  let message = `${list} cannot ${verb} ${Math.abs(net).toFixed(3).replace(/\.?0+$/, '')} µL/min: this part of the circuit has no open path to a reservoir or waste`;
  if (closedValves.length) message += ` (closed: ${closedValves.map((id) => byId.get(id)?.name ?? id).join(', ')})`;
  else if (pumps.length > 1) message += ' and the pump flows do not balance';
  return { message: message + '.', components: [...pumps, ...closedValves] };
}

/** Gaussian elimination with partial pivoting. The systems here are small (tens of nodes). */
export function solveDense(A: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  const M = A.map((row) => Float64Array.from(row));
  const v = Float64Array.from(b);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-15) throw new Error('Singular flow network');
    [M[col], M[piv]] = [M[piv], M[col]];
    [v[col], v[piv]] = [v[piv], v[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
      v[r] -= f * v[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = v[r];
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
    x[r] = sum / M[r][r];
  }
  return x;
}

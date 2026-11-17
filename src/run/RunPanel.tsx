import { useEffect, useState } from 'react';
import type { Pump, Reservoir, Valve } from '../model/types';
import { useApp } from '../ui/store';
import { useRun } from './runStore';

const SPEEDS = [1, 5, 10, 30, 60, 200];

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const fmt = (x: number, digits = 1) => (Math.abs(x) < 1e-9 ? '0' : x.toFixed(digits));

/**
 * Manual test controls for a run. These stand in for the CSV script (phase 6):
 * set pump flows, switch valves and change reservoir liquids while the animation plays.
 */
export function RunPanel() {
  const sim = useRun((s) => s.sim);
  useRun((s) => s.frame);
  const { playing, speed, setPlaying, setSpeed, reset } = useRun();
  const selection = useApp((s) => s.selection);
  if (!sim) return null;
  const s = sim.schematic;
  const pumps = s.components.filter((c): c is Pump => c.kind === 'pump');
  const valves = s.components.filter((c): c is Valve => c.kind === 'valve');
  const reservoirs = s.components.filter((c): c is Reservoir => c.kind === 'reservoir');
  const selPipe = selection?.type === 'pipe' ? s.pipes.find((p) => p.id === selection.id) : undefined;
  const nameOf = (id: string) => s.components.find((c) => c.id === id)?.name ?? id;

  return (
    <aside className="properties run-panel">
      <h2>Test run</h2>
      <div className="transport">
        <button className="primary" onClick={() => setPlaying(!playing)} title="Space">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={reset}>Reset</button>
        <span className="clock" aria-label="Simulated time">
          {fmtTime(sim.t)}
        </span>
      </div>
      <label className="field">
        <span>Speed</span>
        <span className="field-input">
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((x) => (
              <option key={x} value={x}>
                {x}× real time
              </option>
            ))}
          </select>
        </span>
      </label>

      {sim.solution.issues.length > 0 && (
        <div className="issues" role="alert">
          {sim.solution.issues.map((i, k) => (
            <p key={k}>{i.message}</p>
          ))}
        </div>
      )}

      {pumps.length > 0 && (
        <>
          <h3>Pumps</h3>
          <p className="note">Flow in µL/min: positive dispenses, negative aspirates. Enter to apply.</p>
        </>
      )}
      {pumps.map((p) => (
        <PumpRow key={p.id} pump={p} />
      ))}

      {valves.length > 0 && <h3>Valves</h3>}
      {valves.map((v) => {
        const open = sim.inputs.valveOpen[v.id] ?? v.initialOpen;
        return (
          <div className="field" key={v.id}>
            <span>{v.name}</span>
            <span className="field-input">
              <button className={open ? 'toggle on' : 'toggle'} onClick={() => useRun.getState().mutate((x) => x.setValve(v.id, !open))}>
                {open ? 'Open' : 'Closed'}
              </button>
            </span>
          </div>
        );
      })}

      {reservoirs.length > 0 && <h3>Reservoir liquid</h3>}
      {reservoirs.map((r) => (
        <label className="field" key={r.id}>
          <span>{r.name}</span>
          <span className="field-input">
            <input type="color" value={sim.reservoirColor.get(r.id) ?? r.color} onChange={(e) => useRun.getState().mutate((x) => x.setReservoirColor(r.id, e.target.value))} />
          </span>
        </label>
      ))}

      {selPipe && (
        <>
          <h3>Selected pipe</h3>
          <p className="note">
            {nameOf(selPipe.from.comp)} → {nameOf(selPipe.to.comp)}
            <br />
            Flow {fmt(Math.abs(sim.solution.pipeFlow.get(selPipe.id) ?? 0), 2)} µL/min
            {(sim.solution.pipeFlow.get(selPipe.id) ?? 0) < 0 ? ' (towards ' + nameOf(selPipe.from.comp) + ')' : (sim.solution.pipeFlow.get(selPipe.id) ?? 0) > 0 ? ' (towards ' + nameOf(selPipe.to.comp) + ')' : ''}
            <br />
            Speed {fmt(Math.abs(sim.solution.pipeFlow.get(selPipe.id) ?? 0) / 60 / ((Math.PI * selPipe.innerDiameter_mm ** 2) / 4), 2)} mm/s
          </p>
        </>
      )}

      {sim.events.length > 0 && (
        <>
          <h3>Events</h3>
          <ul className="events">
            {sim.events.slice(-6).map((e, k) => (
              <li key={k}>
                <span className="clock">{fmtTime(e.t)}</span> {e.message}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="note small">Temporary controls: the CSV script (phase 6) will drive these.</p>
    </aside>
  );
}

function PumpRow({ pump }: { pump: Pump }) {
  const sim = useRun((s) => s.sim)!;
  const current = sim.inputs.pumpFlow[pump.id] ?? 0;
  const [draft, setDraft] = useState(String(current));
  useEffect(() => setDraft(String(current)), [current]);
  const apply = (q: number) => useRun.getState().mutate((x) => x.setPumpFlow(pump.id, q));
  const fill = sim.pumpFill(pump.id);
  return (
    <div className="pump-row">
      <div className="pump-head">
        <b>{pump.name}</b>
        <span className="note">
          {fmt(fill, 0)} / {pump.syringeVolume_uL} µL
        </span>
      </div>
      <div className="field-input">
        <input
          type="number"
          step="any"
          value={draft}
          aria-label={`${pump.name} flow (µL/min)`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => Number.isFinite(Number(draft)) && apply(Number(draft))}
          onKeyDown={(e) => e.key === 'Enter' && Number.isFinite(Number(draft)) && apply(Number(draft))}
        />
        <button onClick={() => apply(0)} disabled={current === 0}>
          Stop
        </button>
      </div>
    </div>
  );
}

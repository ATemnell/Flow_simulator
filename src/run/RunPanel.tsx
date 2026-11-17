import { useEffect, useState } from 'react';
import { channelArea } from '../model/geometry';
import { isFree, type PipeEnd, type Pump, type Reservoir, type Valve } from '../model/types';
import { fmtTime } from '../script/ScriptDrawer';
import { useApp } from '../ui/store';
import { scriptRunnable, useRun } from './runStore';

const SPEEDS = [1, 5, 10, 30, 60, 200];

/** Parse a flow rate; accepts a comma as decimal mark. Null if not a complete number. */
export function parseFlow(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  return Number(t);
}

const fmt = (x: number, digits = 1) => (Math.abs(x) < 1e-9 ? '0' : x.toFixed(digits));

/** Right-hand panel in Run mode: playback, live readouts, and either script or manual control. */
export function RunPanel() {
  const sim = useRun((s) => s.sim);
  const runner = useRun((s) => s.runner);
  const control = useRun((s) => s.control);
  const script = useRun((s) => s.script);
  useRun((s) => s.frame);
  const { playing, speed, setPlaying, setSpeed, reset, setControl, seek } = useRun();
  const selection = useApp((s) => s.selection);
  if (!sim) return null;
  const s = sim.schematic;
  const pumps = s.components.filter((c): c is Pump => c.kind === 'pump');
  const valves = s.components.filter((c): c is Valve => c.kind === 'valve');
  const reservoirs = s.components.filter((c): c is Reservoir => c.kind === 'reservoir');
  const selPipe = selection?.type === 'pipe' ? s.pipes.find((p) => p.id === selection.id) : undefined;
  const nameOf = (e: PipeEnd) => (isFree(e) ? 'open end' : (s.components.find((c) => c.id === e.comp)?.name ?? e.comp));
  const openEnds = s.pipes.reduce((n, p) => n + (isFree(p.from) ? 1 : 0) + (isFree(p.to) ? 1 : 0), 0);
  const canScript = scriptRunnable(script);
  const manual = control === 'manual';

  return (
    <aside className="properties run-panel">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={!manual} className={!manual ? 'active' : ''} disabled={!canScript} onClick={() => setControl('script')} title={canScript ? '' : 'Fix the script errors (or write a script) to run it'}>
          Script
        </button>
        <button role="tab" aria-selected={manual} className={manual ? 'active' : ''} onClick={() => setControl('manual')}>
          Manual
        </button>
      </div>
      {!canScript && <p className="hint">{script && script.errors.length ? 'The script has errors (see below the canvas), so manual control is used.' : 'No script yet: using manual control.'}</p>}

      <div className="transport">
        <button className="primary" onClick={() => setPlaying(!playing)} title="Space">
          {playing ? 'Pause' : runner?.done ? 'Replay' : 'Play'}
        </button>
        <button onClick={reset}>Reset</button>
        <span className="clock" aria-label="Simulated time">
          {fmtTime(sim.t)}
        </span>
      </div>
      {runner && (
        <div className="timeline-ends">
          <span>0:00</span>
          <span>{fmtTime(runner.duration)}</span>
        </div>
      )}
      {runner && (
        <input
          className="timeline"
          type="range"
          min={0}
          max={runner.duration}
          step={0.1}
          value={Math.min(sim.t, runner.duration)}
          aria-label="Script time"
          onChange={(e) => seek(Number(e.target.value))}
        />
      )}
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

      {openEnds > 0 && (
        <p className="note">
          {openEnds === 1 ? '1 pipe end is' : `${openEnds} pipe ends are`} not connected (×). They act as sealed ends.
        </p>
      )}
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
          <p className="note">Positive flow dispenses, negative aspirates.</p>
          {manual && pumps.every((p) => !(sim.inputs.pumpFlow[p.id] ?? 0)) && (
            <p className="hint" role="status">
              All pumps are stopped, so no liquid moves. Enter a flow rate below, e.g. <b>30</b> for {pumps[0].name}.
            </p>
          )}
        </>
      )}
      {pumps.map((p) =>
        manual ? (
          <PumpRow key={p.id} pump={p} />
        ) : (
          <div className="pump-row" key={p.id}>
            <div className="pump-head">
              <b>{p.name}</b>
              <span className="note">
                {fmt(sim.pumpFill(p.id), 0)} / {p.syringeVolume_uL} µL
              </span>
            </div>
            <div className="readout">{(sim.inputs.pumpFlow[p.id] ?? 0) === 0 ? 'idle' : `${fmt(sim.inputs.pumpFlow[p.id], 2)} µL/min (${sim.inputs.pumpFlow[p.id] > 0 ? 'dispensing' : 'aspirating'})`}</div>
          </div>
        ),
      )}

      {valves.length > 0 && <h3>Valves</h3>}
      {valves.map((v) => {
        const open = sim.inputs.valveOpen[v.id] ?? v.initialOpen;
        return (
          <div className="field" key={v.id}>
            <span>{v.name}</span>
            <span className="field-input">
              {manual ? (
                <button className={open ? 'toggle on' : 'toggle'} onClick={() => useRun.getState().mutate((x) => x.setValve(v.id, !open))}>
                  {open ? 'Open' : 'Closed'}
                </button>
              ) : (
                <span className={open ? 'readout on' : 'readout'}>{open ? 'Open' : 'Closed'}</span>
              )}
            </span>
          </div>
        );
      })}

      {reservoirs.length > 0 && <h3>Reservoir liquid</h3>}
      {reservoirs.map((r) => (
        <label className="field" key={r.id}>
          <span>{r.name}</span>
          <span className="field-input">
            {manual ? (
              <input type="color" value={sim.reservoirColor.get(r.id) ?? r.color} onChange={(e) => useRun.getState().mutate((x) => x.setReservoirColor(r.id, e.target.value))} />
            ) : (
              <span className="readout">
                <span className="swatch" style={{ background: sim.reservoirColor.get(r.id) }} /> {sim.reservoirLiquid.get(r.id)}
              </span>
            )}
          </span>
        </label>
      ))}

      {selPipe && (
        <>
          <h3>Selected pipe</h3>
          <p className="note">
            {nameOf(selPipe.from)} → {nameOf(selPipe.to)}
            <br />
            Flow {fmt(Math.abs(sim.solution.pipeFlow.get(selPipe.id) ?? 0), 2)} µL/min
            {(sim.solution.pipeFlow.get(selPipe.id) ?? 0) < 0 ? ' (towards ' + nameOf(selPipe.from) + ')' : (sim.solution.pipeFlow.get(selPipe.id) ?? 0) > 0 ? ' (towards ' + nameOf(selPipe.to) + ')' : ''}
            <br />
            Speed {fmt(Math.abs(sim.solution.pipeFlow.get(selPipe.id) ?? 0) / 60 / channelArea(selPipe), 2)} mm/s
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
    </aside>
  );
}

function PumpRow({ pump }: { pump: Pump }) {
  const sim = useRun((s) => s.sim)!;
  const current = sim.inputs.pumpFlow[pump.id] ?? 0;
  const [draft, setDraft] = useState(String(current));
  // Follow external changes (Stop button, pump stopping when its syringe is empty) without
  // clobbering what the user is typing, e.g. "30," or "-".
  useEffect(() => setDraft((d) => (parseFlow(d) === current ? d : String(current))), [current]);
  const apply = (q: number) => useRun.getState().mutate((x) => x.setPumpFlow(pump.id, q));
  const onType = (text: string) => {
    setDraft(text);
    const q = parseFlow(text);
    if (q !== null && q !== current) apply(q); // takes effect immediately, no Enter needed
  };
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
          type="text"
          inputMode="decimal"
          value={draft}
          aria-label={`${pump.name} flow (µL/min)`}
          aria-invalid={draft.trim() !== '' && draft.trim() !== '-' && parseFlow(draft) === null}
          onChange={(e) => onType(e.target.value)}
          onBlur={() => setDraft(String(current))}
        />
        <span className="unit">µL/min</span>
        <button onClick={() => apply(0)} disabled={current === 0}>
          Stop
        </button>
      </div>
    </div>
  );
}

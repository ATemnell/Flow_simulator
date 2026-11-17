import { useEffect, useMemo, useRef, useState } from 'react';
import { useRun } from '../run/runStore';
import { downloadText, pickTextFile } from '../ui/files';
import { useApp } from '../ui/store';
import { compileScript, type Problem } from './compile';
import { FLOW_UNITS, TIME_UNITS, VOLUME_UNITS } from './units';

export function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** The CSV script: editable in Edit mode; in Run mode a step list that follows playback. */
export function ScriptDrawer() {
  const mode = useApp((s) => s.mode);
  const text = useApp((s) => s.script);
  const units = useApp((s) => s.units);
  const schematic = useApp((s) => s.schematic);
  const { setScript, setUnits, setError } = useApp.getState();
  const [open, setOpen] = useState(true);
  const compiled = useMemo(() => compileScript(text, schematic, units), [text, schematic, units]);
  const runner = useRun((s) => s.runner);
  const running = mode === 'run';

  const status = !text.trim()
    ? 'empty'
    : compiled.errors.length
      ? `${compiled.errors.length} error${compiled.errors.length > 1 ? 's' : ''}`
      : `${compiled.steps.length} steps · ${fmtTime(compiled.duration)} total${compiled.warnings.length ? ` · ${compiled.warnings.length} warning${compiled.warnings.length > 1 ? 's' : ''}` : ''}`;

  const openCsv = async () => {
    const f = await pickTextFile('.csv,.txt,text/csv,text/plain');
    if (f) setScript(f.text);
  };
  const saveCsv = () => {
    const base = schematic.name.trim().replace(/[^\w-]+/g, '_') || 'script';
    downloadText(`${base}.csv`, text, 'text/csv');
  };

  return (
    <section className={open ? 'drawer open' : 'drawer'} aria-label="Script">
      <header className="drawer-head">
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} Script (CSV)
        </button>
        <span className={compiled.errors.length ? 'status bad' : 'status'}>{status}</span>
        <div className="spacer" />
        <label className="unit-select">
          Volume
          <select value={units.volume} disabled={running} onChange={(e) => setUnits({ ...units, volume: e.target.value as typeof units.volume })}>
            {VOLUME_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="unit-select">
          Flow
          <select value={units.flow} disabled={running} onChange={(e) => setUnits({ ...units, flow: e.target.value as typeof units.flow })}>
            {FLOW_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="unit-select">
          Wait
          <select value={units.time} disabled={running} onChange={(e) => setUnits({ ...units, time: e.target.value as typeof units.time })}>
            {TIME_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        {!running && (
          <>
            <button onClick={openCsv}>Open CSV…</button>
            <button onClick={saveCsv} disabled={!text.trim()}>
              Save CSV
            </button>
          </>
        )}
      </header>
      {open &&
        (running && runner ? (
          <StepList />
        ) : (
          <ScriptEditor
            text={text}
            onChange={setScript}
            readOnly={running}
            errors={compiled.errors}
            warnings={compiled.warnings}
            onReadOnlyClick={() => setError('Switch to Edit mode to change the script.')}
          />
        ))}
    </section>
  );
}

function ScriptEditor({
  text,
  onChange,
  readOnly,
  errors,
  warnings,
  onReadOnlyClick,
}: {
  text: string;
  onChange: (t: string) => void;
  readOnly: boolean;
  errors: Problem[];
  warnings: Problem[];
  onReadOnlyClick: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lineCount = text.split('\n').length;
  const bad = new Set(errors.map((e) => e.line));
  const warn = new Set(warnings.map((e) => e.line));

  const goToLine = (line: number) => {
    const el = ta.current;
    if (!el) return;
    const lines = text.split('\n');
    const start = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.scrollTop = Math.max(0, (line - 3) * lh);
  };

  return (
    <div className="drawer-body">
      <div className="editor">
        <div className="gutter" ref={gutter} aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className={bad.has(i + 1) ? 'bad' : warn.has(i + 1) ? 'warn' : ''}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={ta}
          value={text}
          spellCheck={false}
          readOnly={readOnly}
          onClick={readOnly ? onReadOnlyClick : undefined}
          aria-label="Script CSV"
          placeholder={'Pump 1, Pump 2, Valve 1\n100 10, -100 -10, 1\nWait 2'}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            // Tab inserts a tab instead of leaving the editor (tab is a valid CSV separator).
            if (e.key === 'Tab' && !readOnly) {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = el;
              onChange(text.slice(0, a) + '\t' + text.slice(b));
              requestAnimationFrame(() => el.setSelectionRange(a + 1, a + 1));
            }
          }}
        />
      </div>
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="problems">
          {errors.map((p, i) => (
            <li key={`e${i}`} className="bad" onClick={() => goToLine(p.line)}>
              <b>Line {p.line}</b> {p.message}
            </li>
          ))}
          {warnings.map((p, i) => (
            <li key={`w${i}`} className="warn" onClick={() => goToLine(p.line)}>
              <b>Line {p.line}</b> {p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** During a scripted run: the steps, with the current one highlighted. Click a step to jump to it. */
function StepList() {
  const runner = useRun((s) => s.runner)!;
  useRun((s) => s.frame);
  const current = runner.currentStep();
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <div className="drawer-body">
      <ol className="steps" ref={listRef}>
        {runner.script.steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          const progress = state === 'current' && s.duration > 0 ? Math.min(1, (runner.t - s.start) / s.duration) : state === 'done' ? 1 : 0;
          return (
            <li key={i} className={state} onClick={() => useRun.getState().seek(s.start)} title="Jump to this step">
              <span className="clock">{fmtTime(s.start)}</span>
              <span className="line">line {s.line}</span>
              <code>{s.source}</code>
              <span className="dur">{s.duration > 0 ? fmtTime(s.duration) : 'instant'}</span>
              {state === 'current' && <span className="progress" style={{ width: `${progress * 100}%` }} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { deleteComponent, deletePipe, rotateComponent, updateComponent, updatePipe } from '../model/edit';
import { channelArea, pipeLength_mm, pipeVolume_uL } from '../model/geometry';
import type { Component, Pipe, Schematic } from '../model/types';
import { useApp } from '../ui/store';

/** Text/number input that commits on blur or Enter (one undo step per edit, not per keystroke). */
function Field({
  label,
  value,
  onCommit,
  type = 'text',
  min,
  max,
  step,
  unit,
  validate,
}: {
  label: string;
  value: string | number;
  onCommit: (v: string) => void;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  validate?: (v: string) => string | null;
}) {
  const [draft, setDraft] = useState(String(value));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setDraft(String(value));
    setProblem(null);
  }, [value]);
  const commit = () => {
    if (draft === String(value)) return;
    const p = validate?.(draft) ?? null;
    setProblem(p);
    if (!p) onCommit(draft);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          type={type}
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(String(value));
          }}
          aria-invalid={!!problem}
        />
        {unit && <em>{unit}</em>}
      </span>
      {problem && <small className="field-problem">{problem}</small>}
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span>{label}</span>
      <span className="field-input">{children}</span>
    </div>
  );
}

const positive = (v: string) => (Number(v) > 0 ? null : 'Must be greater than 0');
const intIn = (lo: number, hi: number) => (v: string) => (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? null : `Whole number ${lo}–${hi}`);

export function PropertiesPanel() {
  const schematic = useApp((s) => s.schematic);
  const selection = useApp((s) => s.selection);
  const comp = selection?.type === 'comp' ? schematic.components.find((c) => c.id === selection.id) : undefined;
  const pipe = selection?.type === 'pipe' ? schematic.pipes.find((p) => p.id === selection.id) : undefined;
  return (
    <aside className="properties">
      {comp ? <ComponentProps s={schematic} c={comp} /> : pipe ? <PipeProps s={schematic} p={pipe} /> : <DocumentProps s={schematic} />}
    </aside>
  );
}

function DocumentProps({ s }: { s: Schematic }) {
  const commit = useApp((st) => st.commit);
  return (
    <>
      <h2>Schematic</h2>
      <Field label="Name" value={s.name} onCommit={(v) => commit({ ...s, name: v })} />
      <div className="help">
        <h3>How to draw</h3>
        <ul>
          <li>Pick a part under <b>Add</b> and click on the canvas to place it. Shift-click places several.</li>
          <li>
            <b>Pipe</b> (P): click a port, click to add corners, click another port to finish. Click on an existing pipe to start or end a T-junction.
          </li>
          <li>Drag a part to move it. Drag a pipe segment to re-route it.</li>
          <li>Pipes may cross; they only connect at junction dots.</li>
        </ul>
        <h3>Keys</h3>
        <ul className="keys">
          <li>
            <kbd>R</kbd> rotate · <kbd>Del</kbd> delete
          </li>
          <li>
            <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Ctrl</kbd>+<kbd>Y</kbd> redo
          </li>
          <li>
            <kbd>Esc</kbd> cancel · <kbd>Backspace</kbd> remove last pipe corner
          </li>
          <li>Wheel: zoom · drag background or middle-drag: pan</li>
        </ul>
      </div>
    </>
  );
}

const KIND_TITLE: Record<Component['kind'], string> = {
  pump: 'Syringe pump',
  valve: 'Valve',
  flowcell: 'Flow cell',
  reservoir: 'Reservoir',
  waste: 'Waste',
  junction: 'Junction',
};

function ComponentProps({ s, c }: { s: Schematic; c: Component }) {
  const commit = useApp((st) => st.commit);
  const select = useApp((st) => st.select);
  const set = (patch: Partial<Component>) => commit(updateComponent(s, c.id, patch));
  const uniqueName = (v: string) => {
    const name = v.trim();
    if (!name) return 'Name is required';
    if (name.includes(',')) return 'Names cannot contain commas (they are CSV column headers)';
    return s.components.some((k) => k.id !== c.id && k.name === name) ? 'Another part already has this name' : null;
  };
  const pipesHere = s.pipes.filter((p) => p.from.comp === c.id || p.to.comp === c.id).length;

  return (
    <>
      <h2>{KIND_TITLE[c.kind]}</h2>
      {c.kind !== 'junction' && <Field label="Name" value={c.name} validate={uniqueName} onCommit={(v) => set({ name: v.trim() })} />}

      {c.kind === 'pump' && (
        <>
          <Field label="Syringe volume" type="number" unit="µL" min={1} value={c.syringeVolume_uL} validate={positive} onCommit={(v) => set({ syringeVolume_uL: Number(v) })} />
          <Field
            label="Initial fill"
            type="number"
            unit="µL"
            min={0}
            value={c.initialFill_uL}
            validate={(v) => (Number(v) >= 0 && Number(v) <= c.syringeVolume_uL ? null : `0–${c.syringeVolume_uL} µL`)}
            onCommit={(v) => set({ initialFill_uL: Number(v) })}
          />
          <Row label="Initial liquid">
            <input type="color" value={c.initialColor} onChange={(e) => set({ initialColor: e.target.value })} />
          </Row>
        </>
      )}

      {c.kind === 'valve' && (
        <Row label="At start">
          <select value={c.initialOpen ? 'open' : 'closed'} onChange={(e) => set({ initialOpen: e.target.value === 'open' })}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </Row>
      )}

      {c.kind === 'flowcell' && (
        <>
          <Field label="Inlets" type="number" min={1} max={8} value={c.inlets} validate={intIn(1, 8)} onCommit={(v) => set({ inlets: Number(v) })} />
          <Field label="Outlets" type="number" min={1} max={8} value={c.outlets} validate={intIn(1, 8)} onCommit={(v) => set({ outlets: Number(v) })} />
          <p className="note">Reducing inlets/outlets removes pipes on the removed ports.</p>
        </>
      )}

      {c.kind === 'reservoir' && (
        <>
          <Field label="Liquid" value={c.liquid} onCommit={(v) => set({ liquid: v })} />
          <Row label="Colour">
            <input type="color" value={c.color} onChange={(e) => set({ color: e.target.value })} />
          </Row>
        </>
      )}

      {c.kind === 'junction' && <p className="note">Connects {pipesHere} pipes.</p>}

      <div className="actions">
        {c.kind !== 'junction' && <button onClick={() => commit(rotateComponent(s, c.id))}>Rotate (R)</button>}
        <button
          className="danger"
          onClick={() => {
            commit(deleteComponent(s, c.id));
            select(null);
          }}
        >
          Delete
        </button>
      </div>
    </>
  );
}

function PipeProps({ s, p }: { s: Schematic; p: Pipe }) {
  const commit = useApp((st) => st.commit);
  const select = useApp((st) => st.select);
  const name = (id: string) => s.components.find((c) => c.id === id)?.name ?? id;
  let length = 0;
  let volume = 0;
  try {
    length = pipeLength_mm(s, p);
    volume = pipeVolume_uL(s, p);
  } catch {
    /* dangling — validation reports it */
  }
  return (
    <>
      <h2>Pipe</h2>
      <p className="note">
        {name(p.from.comp)} → {name(p.to.comp)}
      </p>
      <Field label="Width" type="number" unit="mm" min={0.01} step={0.05} value={p.width_mm} validate={positive} onCommit={(v) => commit(updatePipe(s, p.id, { width_mm: Number(v) }))} />
      <Field label="Depth" type="number" unit="mm" min={0.01} step={0.05} value={p.depth_mm} validate={positive} onCommit={(v) => commit(updatePipe(s, p.id, { depth_mm: Number(v) }))} />
      <Row label="Cross-section">
        <output>{channelArea(p).toFixed(3)} mm² (rectangular)</output>
      </Row>
      <Row label="Length">
        <output>{length.toFixed(0)} mm</output>
      </Row>
      <Row label="Volume">
        <output>{volume.toFixed(1)} µL</output>
      </Row>
      <div className="actions">
        <button
          className="danger"
          onClick={() => {
            commit(deletePipe(s, p.id));
            select(null);
          }}
        >
          Delete
        </button>
      </div>
    </>
  );
}

import { useEffect } from 'react';
import { EditorCanvas } from '../editor/EditorCanvas';
import { Palette } from '../editor/Palette';
import { PropertiesPanel } from '../editor/PropertiesPanel';
import { useEditorKeys } from '../editor/useEditorKeys';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { parseSchematic, serializeSchematic, validateSchematic } from '../model/serialize';
import { RunPanel } from '../run/RunPanel';
import { useRun } from '../run/runStore';
import { useRunLoop } from '../run/useRunLoop';
import { downloadText, pickTextFile } from './files';
import { emptySchematic, useApp } from './store';

export function App() {
  const schematic = useApp((s) => s.schematic);
  const error = useApp((s) => s.error);
  const mode = useApp((s) => s.mode);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const { load, setError, undo, redo, setMode } = useApp.getState();
  useEditorKeys();
  useRunLoop();

  // Leaving run mode (or loading another document) discards the simulation.
  useEffect(() => {
    if (mode === 'edit') useRun.getState().stop();
  }, [mode]);

  const startRun = () => {
    const problems = validateSchematic(schematic);
    if (problems.length) return setError(`Cannot run:\n${problems.join('\n')}`);
    useRun.getState().start(schematic);
    setMode('run');
  };

  const open = async () => {
    const f = await pickTextFile('.json,application/json');
    if (!f) return;
    try {
      load(parseSchematic(f.text));
    } catch (e) {
      setError(`Could not open ${f.name}: ${(e as Error).message}`);
    }
  };

  const save = () => {
    const problems = validateSchematic(schematic);
    if (problems.length) return setError(`Cannot save:\n${problems.join('\n')}`);
    const base = schematic.name.trim().replace(/[^\w-]+/g, '_') || 'schematic';
    downloadText(`${base}.json`, serializeSchematic(schematic));
  };

  const running = mode === 'run';
  return (
    <div className="app">
      <header className="toolbar">
        <strong className="title">Flow Cell Simulator</strong>
        <span className="doc-name">{schematic.name}</span>
        <div className="segmented" role="group" aria-label="Mode">
          <button className={running ? '' : 'active'} onClick={() => setMode('edit')}>
            Edit
          </button>
          <button className={running ? 'active' : ''} onClick={() => !running && startRun()}>
            Run
          </button>
        </div>
        {!running && (
          <div className="toolbar-group">
            <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
              Redo
            </button>
          </div>
        )}
        <div className="spacer" />
        <button onClick={() => load(emptySchematic())}>New</button>
        <button onClick={() => load(twoInletFlowCell)}>Example</button>
        <button onClick={open}>Open…</button>
        <button onClick={save}>Save</button>
      </header>
      {error && (
        <div className="error" role="alert">
          <pre>{error}</pre>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <main className="workspace">
        {!running && <Palette />}
        <div className="canvas-wrap">
          <EditorCanvas />
        </div>
        {running ? <RunPanel /> : <PropertiesPanel />}
      </main>
      <footer className="statusbar">
        {running
          ? 'Running: editing is locked. Click a pipe to see its flow. Space = play/pause.'
          : `${schematic.components.filter((c) => c.kind !== 'junction').length} parts · ${schematic.pipes.length} pipes`}
      </footer>
    </div>
  );
}

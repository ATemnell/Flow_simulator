import { useEffect } from 'react';
import { EditorCanvas } from '../editor/EditorCanvas';
import { Palette } from '../editor/Palette';
import { PropertiesPanel } from '../editor/PropertiesPanel';
import { useEditorKeys } from '../editor/useEditorKeys';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { twoInletFlowCellScript } from '../examples/twoInletFlowCellScript';
import { validateSchematic } from '../model/serialize';
import { compileScript } from '../script/compile';
import { ScriptDrawer } from '../script/ScriptDrawer';
import { DEFAULT_UNITS } from '../script/units';
import { RunPanel } from '../run/RunPanel';
import { useRun } from '../run/runStore';
import { useRunLoop } from '../run/useRunLoop';
import { canUseHandles } from './files';
import { loadDetached, openProject, reopenRecent, saveProject, useCsvWatch, useFiles, useRecentProject } from './project';
import { emptySchematic, isDirty, useApp } from './store';

const DISCARD_PROMPT = 'You have unsaved changes. Discard them?';

/** Ask before throwing away unsaved work. True = go ahead. */
function confirmDiscard(): boolean {
  return !isDirty(useApp.getState()) || window.confirm(DISCARD_PROMPT);
}

export function App() {
  const schematic = useApp((s) => s.schematic);
  const error = useApp((s) => s.error);
  const mode = useApp((s) => s.mode);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const dirty = useApp(isDirty);
  const { setError, undo, redo, setMode } = useApp.getState();
  const projectName = useFiles((s) => s.projectName);
  const hasProjectFile = useFiles((s) => s.project !== null);
  const recent = useFiles((s) => s.recent);
  useEditorKeys();
  useRunLoop();
  useRecentProject();
  useCsvWatch();

  // Ctrl+S saves (overwriting the project file), Ctrl+Shift+S saves as.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProject(e.shiftKey);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Warn before closing or reloading the tab with unsaved changes (the browser shows its own dialog).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // required by some browsers to show the dialog
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Leaving run mode (or loading another document) discards the simulation.
  useEffect(() => {
    if (mode === 'edit') useRun.getState().stop();
  }, [mode]);

  const startRun = () => {
    const problems = validateSchematic(schematic);
    if (problems.length) return setError(`Cannot run:\n${problems.join('\n')}`);
    const { script, units } = useApp.getState();
    useRun.getState().start(schematic, script.trim() ? compileScript(script, schematic, units) : null);
    setMode('run');
  };

  const open = () => confirmDiscard() && openProject();
  const reopen = () => confirmDiscard() && reopenRecent();

  const running = mode === 'run';
  return (
    <div className="app">
      <header className="toolbar">
        <strong className="title">Flow Cell Simulator</strong>
        <span className="doc-name" title={projectName ? `Saved to ${projectName}` : 'Not saved to a file yet'}>
          {schematic.name}
          {projectName && <span className="file-name"> — {projectName}</span>}
          {dirty && (
            <span className="unsaved" title="Changes since the last Save or Open">
              {' '}
              • unsaved
            </span>
          )}
        </span>
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
        <button onClick={() => confirmDiscard() && loadDetached(emptySchematic())}>New</button>
        <button onClick={() => confirmDiscard() && loadDetached(twoInletFlowCell, { text: twoInletFlowCellScript, units: DEFAULT_UNITS })}>Example</button>
        <button onClick={open}>Open…</button>
        <button onClick={() => saveProject()} title={hasProjectFile ? `Overwrite ${projectName} (Ctrl+S)` : 'Choose a file and save (Ctrl+S)'}>
          Save
        </button>
        {canUseHandles && (
          <button onClick={() => saveProject(true)} title="Save to a new file (Ctrl+Shift+S)">
            Save As…
          </button>
        )}
      </header>
      {recent && (
        <div className="notice">
          <span>
            Continue where you left off: <b>{recent.name}</b>
          </span>
          <button onClick={reopen}>Reopen</button>
          <button className="link" onClick={() => useFiles.setState({ recent: null })}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          <pre>{error}</pre>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      <main className="workspace">
        {!running && <Palette />}
        <div className="center">
          <div className="canvas-wrap">
            <EditorCanvas />
          </div>
          <ScriptDrawer />
        </div>
        {running ? <RunPanel /> : <PropertiesPanel />}
      </main>
      <footer className="statusbar">
        {running
          ? 'Running: editing is locked. Click a pipe to see its flow, click a script step to jump to it. Space = play/pause.'
          : `${schematic.components.filter((c) => c.kind !== 'junction').length} parts · ${schematic.pipes.length} pipes`}
      </footer>
    </div>
  );
}

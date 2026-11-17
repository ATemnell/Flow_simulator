import { EditorCanvas } from '../editor/EditorCanvas';
import { Palette } from '../editor/Palette';
import { PropertiesPanel } from '../editor/PropertiesPanel';
import { useEditorKeys } from '../editor/useEditorKeys';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { parseSchematic, serializeSchematic, validateSchematic } from '../model/serialize';
import { downloadText, pickTextFile } from './files';
import { emptySchematic, useApp } from './store';

export function App() {
  const schematic = useApp((s) => s.schematic);
  const error = useApp((s) => s.error);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const { load, setError, undo, redo } = useApp.getState();
  useEditorKeys();

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

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="title">Flow Cell Simulator</strong>
        <span className="doc-name">{schematic.name}</span>
        <div className="toolbar-group">
          <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
            Redo
          </button>
        </div>
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
        <Palette />
        <div className="canvas-wrap">
          <EditorCanvas />
        </div>
        <PropertiesPanel />
      </main>
      <footer className="statusbar">
        {schematic.components.filter((c) => c.kind !== 'junction').length} parts · {schematic.pipes.length} pipes
      </footer>
    </div>
  );
}

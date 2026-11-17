import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { parseSchematic, serializeSchematic } from '../model/serialize';
import { SchematicCanvas } from '../render/SchematicCanvas';
import { downloadText, pickTextFile } from './files';
import { emptySchematic, useApp } from './store';

export function App() {
  const { schematic, error, setSchematic, setError } = useApp();

  const open = async () => {
    const f = await pickTextFile('.json,application/json');
    if (!f) return;
    try {
      setSchematic(parseSchematic(f.text));
    } catch (e) {
      setError(`Could not open ${f.name}: ${(e as Error).message}`);
    }
  };

  const save = () => {
    const base = schematic.name.trim().replace(/[^\w-]+/g, '_') || 'schematic';
    downloadText(`${base}.json`, serializeSchematic(schematic));
  };

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="title">Flow Cell Simulator</strong>
        <span className="doc-name">{schematic.name}</span>
        <div className="spacer" />
        <button onClick={() => setSchematic(emptySchematic())}>New</button>
        <button onClick={() => setSchematic(twoInletFlowCell)}>Example</button>
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
        <SchematicCanvas schematic={schematic} />
      </main>
      <footer className="statusbar">
        {schematic.components.length} components · {schematic.pipes.length} pipes · scroll to zoom, drag to pan
      </footer>
    </div>
  );
}

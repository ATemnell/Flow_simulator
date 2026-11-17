import type { ComponentKind } from '../model/types';
import { useApp, type Tool } from '../ui/store';

const ITEMS: { label: string; key?: string; tool: Tool }[] = [
  { label: 'Select', key: 'V', tool: { type: 'select' } },
  { label: 'Pipe', key: 'P', tool: { type: 'pipe' } },
  ...(
    [
      ['Pump', 'pump'],
      ['Valve', 'valve'],
      ['Flow cell', 'flowcell'],
      ['Reservoir', 'reservoir'],
      ['Waste', 'waste'],
    ] as [string, ComponentKind][]
  ).map(([label, kind]) => ({ label, tool: { type: 'place', kind } as Tool })),
];

const same = (a: Tool, b: Tool) => a.type === b.type && (a.type !== 'place' || (b.type === 'place' && a.kind === b.kind));

export function Palette() {
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  return (
    <nav className="palette" aria-label="Tools">
      {ITEMS.map((it, i) => (
        <div key={it.label} className="palette-group">
          {i === 2 && <div className="palette-sep">Add</div>}
          <button className={same(tool, it.tool) ? 'active' : ''} onClick={() => setTool(it.tool)} title={it.key ? `${it.label} (${it.key})` : `Add ${it.label} (Shift-click to place several)`}>
            {it.label}
            {it.key && <kbd>{it.key}</kbd>}
          </button>
        </div>
      ))}
    </nav>
  );
}

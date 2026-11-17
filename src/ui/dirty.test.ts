import { beforeEach, describe, expect, it } from 'vitest';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { twoInletFlowCellScript } from '../examples/twoInletFlowCellScript';
import { makeComponent, addComponent } from '../model/edit';
import { DEFAULT_UNITS } from '../script/units';
import { emptySchematic, isDirty, useApp } from './store';

const st = () => useApp.getState();

describe('unsaved changes', () => {
  beforeEach(() => st().load(twoInletFlowCell, { text: twoInletFlowCellScript, units: DEFAULT_UNITS }));

  it('a freshly opened document is clean', () => {
    expect(isDirty(st())).toBe(false);
  });

  it('an edit makes it dirty; undoing back to the saved state makes it clean again', () => {
    st().commit(addComponent(st().schematic, makeComponent(st().schematic, 'pump', { x: 0, y: 0 })));
    expect(isDirty(st())).toBe(true);
    st().undo();
    expect(isDirty(st())).toBe(false);
  });

  it('script and unit changes count too', () => {
    st().setScript(st().script + '\nWait 1');
    expect(isDirty(st())).toBe(true);
    st().setScript(twoInletFlowCellScript);
    expect(isDirty(st())).toBe(false);
    st().setUnits({ ...DEFAULT_UNITS, flow: 'mL/min' });
    expect(isDirty(st())).toBe(true);
  });

  it('saving the document makes it clean; saving only the CSV leaves schematic edits unsaved', () => {
    st().commit(addComponent(st().schematic, makeComponent(st().schematic, 'pump', { x: 0, y: 0 })));
    st().setScript('Pump 1\n10 10');
    st().markSaved('script');
    expect(isDirty(st())).toBe(true);
    st().markSaved('document');
    expect(isDirty(st())).toBe(false);
  });

  it('New starts clean', () => {
    st().load(emptySchematic());
    expect(isDirty(st())).toBe(false);
  });
});

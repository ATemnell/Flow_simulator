import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument } from '../model/serialize';
import { twoInletFlowCell } from '../examples/twoInletFlowCell';
import { DEFAULT_UNITS } from '../script/units';
import { decodeText } from './files';

const bytes = (...b: number[]) => new Uint8Array(b).buffer;

describe('reading CSV files', () => {
  it('reads UTF-8 and drops the BOM Excel writes for "CSV UTF-8"', () => {
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0xc2, 0xb5, 0x4c))).toBe('µL');
  });
  it('falls back to the Windows codepage for Excel\'s plain "CSV"', () => {
    expect(decodeText(bytes(0xb5, 0x4c, 0x3b, 0xe5))).toBe('µL;å');
  });
});

describe('linked CSV in the project file', () => {
  it('keeps the CSV file name alongside the embedded script', () => {
    const json = serializeDocument(twoInletFlowCell, { text: 'Pump 1\n10 10', units: DEFAULT_UNITS, file: 'run1.csv' });
    expect(parseDocument(json).script).toEqual({ text: 'Pump 1\n10 10', units: DEFAULT_UNITS, file: 'run1.csv' });
  });
  it('older files without a link still load', () => {
    const json = serializeDocument(twoInletFlowCell, { text: 'Pump 1\n10 10', units: DEFAULT_UNITS });
    expect(parseDocument(json).script?.file).toBeUndefined();
  });
});

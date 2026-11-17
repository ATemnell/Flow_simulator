import { describe, expect, it } from 'vitest';
import { parseFlow } from './RunPanel';

describe('parseFlow', () => {
  it('accepts dot or comma decimals and signs', () => {
    expect(parseFlow('30')).toBe(30);
    expect(parseFlow('-60')).toBe(-60);
    expect(parseFlow('30,5')).toBe(30.5);
    expect(parseFlow(' 0.25 ')).toBe(0.25);
    expect(parseFlow('30.')).toBe(30);
  });
  it('rejects incomplete input', () => {
    expect(parseFlow('')).toBeNull();
    expect(parseFlow('-')).toBeNull();
    expect(parseFlow('abc')).toBeNull();
    expect(parseFlow('1e3x')).toBeNull();
  });
});

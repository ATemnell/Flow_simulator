/** Colour helpers for liquids. Colours are '#rrggbb'; EMPTY ('') means air / no liquid. */

export const EMPTY = '';

export function parseHex(c: string): [number, number, number] {
  const h = c.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

/** Volume-weighted blend. Air is ignored unless there is nothing else. */
export function blend(parts: { color: string; vol: number }[]): string {
  let tot = 0;
  const acc = [0, 0, 0];
  for (const p of parts) {
    if (p.color === EMPTY || p.vol <= 0) continue;
    const rgb = parseHex(p.color);
    for (let i = 0; i < 3; i++) acc[i] += rgb[i] * p.vol;
    tot += p.vol;
  }
  if (tot === 0) return EMPTY;
  return toHex([acc[0] / tot, acc[1] / tot, acc[2] / tot]);
}

/** Close enough to be drawn (and stored) as one plug. */
export function similar(a: string, b: string, tol = 3): boolean {
  if (a === b) return true;
  if (a === EMPTY || b === EMPTY) return false;
  const x = parseHex(a);
  const y = parseHex(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) <= tol;
}

/** Normalise a CSS colour name or hex to '#rrggbb' (browser only; falls back to the input). */
export function normalizeColor(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return toHex(parseHex(c));
  if (typeof document === 'undefined') return c;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return c;
  ctx.fillStyle = '#000';
  ctx.fillStyle = c;
  return ctx.fillStyle;
}

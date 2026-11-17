/** Colour words accepted in scripts (CSS names) plus #rgb / #rrggbb. Works without a browser. */
const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  red: '#ff0000',
  darkred: '#8b0000',
  maroon: '#800000',
  crimson: '#dc143c',
  pink: '#ffc0cb',
  hotpink: '#ff69b4',
  salmon: '#fa8072',
  coral: '#ff7f50',
  orange: '#ffa500',
  darkorange: '#ff8c00',
  gold: '#ffd700',
  yellow: '#ffff00',
  khaki: '#f0e68c',
  beige: '#f5f5dc',
  brown: '#a52a2a',
  chocolate: '#d2691e',
  olive: '#808000',
  lime: '#00ff00',
  green: '#008000',
  darkgreen: '#006400',
  lightgreen: '#90ee90',
  teal: '#008080',
  cyan: '#00ffff',
  aqua: '#00ffff',
  turquoise: '#40e0d0',
  skyblue: '#87ceeb',
  lightblue: '#add8e6',
  blue: '#0000ff',
  darkblue: '#00008b',
  navy: '#000080',
  royalblue: '#4169e1',
  indigo: '#4b0082',
  purple: '#800080',
  violet: '#ee82ee',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
};

/** '#rrggbb' for a colour word or hex, or null if it is not a colour. */
export function parseColor(word: string): string | null {
  const w = word.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(w)) return w;
  if (/^#[0-9a-f]{3}$/.test(w)) return '#' + [...w.slice(1)].map((c) => c + c).join('');
  return NAMED[w] ?? null;
}

export const COLOR_NAMES = Object.keys(NAMED);

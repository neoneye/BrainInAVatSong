// font.js: a hand-made single-stroke font for a finger writing in dust, and the heart.
// Glyph grid: x 0..w to the right, y 0 (cap height) .. 6 (baseline) downward. A glyph is strokes separated by "|"
// (the finger lifts between them); a stroke is pieces separated by ";" (drawn without lifting); a piece starting with
// "~" is a smooth curve through its points, otherwise straight segments.

const G = {
  A: [4, '0,6 2,0 4,6|0.8,4 3.2,4'],
  B: [3.8, '0,0 0,6|~0,0 2.3,0.1 3.4,1.5 2.3,2.9 0.2,3;~0.2,3 2.7,3.1 3.8,4.5 2.7,5.9 0,6'],
  C: [3.8, '~3.8,1.3 2.3,0 0.5,1.2 0,3 0.5,4.8 2.3,6 3.8,4.7'],
  D: [3.9, '0,0 0,6|~0,0 2,0.1 3.7,1.6 3.9,3 3.7,4.4 2,5.9 0,6'],
  E: [3.5, '3.5,0 0,0 0,6 3.5,6|0,3 2.7,3'],
  F: [3.5, '3.5,0 0,0 0,6|0,3 2.7,3'],
  G: [4, '~3.8,1.3 2.3,0 0.5,1.2 0,3 0.5,4.8 2.2,6 3.7,5 3.9,3.4;3.9,3.4 2.1,3.4'],
  H: [4, '0,0 0,6|4,0 4,6|0,3 4,3'],
  I: [0.6, '0.3,0 0.3,6'],
  J: [3.2, '~3.2,0 3.2,4.3 2.6,5.6 1.5,6 0.4,5.6 0,4.6'],
  K: [3.9, '0,0 0,6|3.7,0 0,3.5|1.3,2.5 3.9,6'],
  L: [3.4, '0,0 0,6 3.4,6'],
  M: [5, '0,6 0,0 2.5,4 5,0 5,6'],
  N: [4, '0,6 0,0 4,6 4,0'],
  O: [4.2, '~2.1,0 0.6,0.9 0,3 0.6,5.1 2.1,6 3.6,5.1 4.2,3 3.6,0.9 2.1,0'],
  P: [3.7, '0,6 0,0|~0,0 2.4,0.1 3.6,1.6 2.4,3.2 0,3.3'],
  Q: [4.2, '~2.1,0 0.6,0.9 0,3 0.6,5.1 2.1,6 3.6,5.1 4.2,3 3.6,0.9 2.1,0|2.5,4.3 4.3,6.4'],
  R: [3.9, '0,6 0,0|~0,0 2.4,0.1 3.6,1.6 2.4,3.2 0,3.3;1.5,3.3 3.9,6'],
  S: [3.8, '~3.6,1.1 2.6,0.1 1.1,0.2 0.2,1.5 1.1,2.8 2.8,3.3 3.7,4.6 2.8,5.8 1.3,6 0.1,5'],
  T: [4, '0,0 4,0|2,0 2,6'],
  U: [4, '~0,0 0,4.1 0.6,5.5 2,6 3.4,5.5 4,4.1 4,0'],
  V: [4, '0,0 2,6 4,0'],
  W: [5.6, '0,0 1.3,6 2.8,1.6 4.3,6 5.6,0'],
  X: [3.9, '0,0 3.9,6|3.9,0 0,6'],
  Y: [4, '0,0 2,3.1 4,0|2,3.1 2,6'],
  Z: [3.8, '0,0 3.8,0 0,6 3.8,6'],
  0: [3.6, '~1.8,0 0.4,1 0,3 0.4,5 1.8,6 3.2,5 3.6,3 3.2,1 1.8,0'],
  1: [1.8, '0,1.4 1.6,0 1.6,6'],
  2: [3.6, '~0.2,1.5 1,0.3 2.5,0.1 3.4,1.4 2.7,3;2.7,3 0,6 3.6,6'],
  3: [3.5, '~0.2,0.9 1.6,0 3.2,0.9 2.9,2.3 1.5,2.9;~1.5,2.9 3.1,3.5 3.5,4.8 2,6 0.1,5.1'],
  4: [3.9, '2.9,6 2.9,0 0,4.2 3.9,4.2'],
  5: [3.5, '3.3,0 0.5,0 0.3,2.7;~0.3,2.7 1.9,2.3 3.4,3.3 3.4,4.9 1.9,6 0.1,5.2'],
  6: [3.5, '~3.2,0.7 1.9,0 0.5,1.5 0,4 0.6,5.6 1.9,6 3.2,5.3 3.4,3.9 2,3 0.3,3.9'],
  7: [3.6, '0,0 3.6,0 1.2,6'],
  8: [3.5, '~1.75,2.9 0.5,2.1 0.5,0.7 1.75,0 3,0.7 3,2.1 1.75,2.9 0.2,4 0.3,5.3 1.75,6 3.2,5.3 3.3,4 1.75,2.9'],
  9: [3.5, '~3.3,2.1 2,3 0.5,2.6 0.2,1.2 1.6,0 3,0.6 3.3,2.1 3.2,4.4 2.2,5.8 0.6,5.8'],
  '.': [0.6, '0.3,5.8 0.3,6'],
  ',': [0.8, '0.6,5.5 0.1,7'],
  ':': [0.6, '0.3,2 0.3,2.2|0.3,5.8 0.3,6'],
  ';': [0.8, '0.5,2 0.5,2.2|0.6,5.5 0.1,7'],
  '!': [0.6, '0.3,0 0.3,4.1|0.3,5.8 0.3,6'],
  '?': [3.2, '~0.1,1.4 0.9,0.2 2.3,0.1 3.1,1.3 2.5,2.6 1.6,3.4 1.6,4.3|1.6,5.8 1.6,6'],
  "'": [0.6, '0.4,0 0.2,1.5'],
  '"': [1.8, '0.4,0 0.2,1.5|1.6,0 1.4,1.5'],
  '-': [2.6, '0,3.3 2.6,3.3'],
  '+': [3, '0,3.3 3,3.3|1.5,1.8 1.5,4.8'],
  '=': [2.8, '0,2.5 2.8,2.5|0,4.1 2.8,4.1'],
  '/': [2.8, '2.8,0 0,6'],
  '(': [1.4, '~1.4,-0.3 0.2,1.5 0,3 0.2,4.5 1.4,6.3'],
  ')': [1.4, '~0,-0.3 1.2,1.5 1.4,3 1.2,4.5 0,6.3'],
  '&': [4.2, '~4.1,6 1,2 0.9,0.8 1.8,0 2.7,0.8 2.4,2 0.4,3.6 0,4.8 1,6 2.4,5.8 4,3.4'],
  '*': [2.6, '1.3,1 1.3,3.6|0.2,1.6 2.4,3|2.4,1.6 0.2,3'],
  '#': [3.8, '1.4,0.5 0.9,5.5|3,0.5 2.5,5.5|0.1,2 3.8,2|0,4 3.7,4'],
  '@': [4.6, '~3.2,2.6 2.3,1.9 1.5,2.9 2.1,4.1 3.1,3.6 3.3,2.2 3.6,4 4.5,3.4 4.3,1.3 2.6,0 0.7,0.9 0,3 0.7,5.1 2.5,6 4,5.4'],
  '…': [3.6, '0.3,5.8 0.3,6|1.8,5.8 1.8,6|3.3,5.8 3.3,6'],
};
export const SPACE = 3.8, GAP = 1.8, HEART_W = 6.4;

// smooth curve through points (Catmull-Rom); closed if the first and last points coincide
function curve(P) {
  const n = P.length, closed = n > 3 && P[0][0] === P[n - 1][0] && P[0][1] === P[n - 1][1], out = [];
  const at = i => closed ? P[((i % (n - 1)) + (n - 1)) % (n - 1)] : P[Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < n - 1; i++) {
    const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
    for (let k = 0; k < 12; k++) { const t = k / 12, t2 = t * t, t3 = t2 * t;
      out.push([0.5 * (2 * b[0] + (c[0] - a[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (3 * b[0] - a[0] - 3 * c[0] + d[0]) * t3),
        0.5 * (2 * b[1] + (c[1] - a[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (3 * b[1] - a[1] - 3 * c[1] + d[1]) * t3)]); }
  }
  out.push(P[n - 1].slice()); return out;
}
const CACHE = {};
// strokes of a character as polylines in glyph units, plus its width; null for unknown characters
export function glyph(ch) {
  if (ch === '♥') return { w: HEART_W, strokes: [heart(HEART_W / 2, 2.75, HEART_W / 32 * 0.98)] };
  if (!G[ch]) return null;
  if (!CACHE[ch]) {
    const [w, src] = G[ch];
    CACHE[ch] = { w, strokes: src.split('|').map(st => { const pts = [];
      for (const piece of st.split(';')) { const sm = piece[0] === '~', P = (sm ? piece.slice(1) : piece).trim().split(/\s+/).map(q => q.split(',').map(Number));
        for (const q of sm ? curve(P) : P) { const l = pts[pts.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); } }
      return pts; }) };
  }
  return CACHE[ch];
}
// the heart curve of the experiment, one closed stroke starting and ending in the notch at the top; about 32 s wide
// and 29 s tall, centred on (cx, cy)
export function heart(cx, cy, s) {
  const pts = []; for (let k = 0; k <= 160; k++) { const t = Math.PI * 2 * k / 160; pts.push([cx + s * 16 * Math.sin(t) ** 3, cy - s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) - s * 2.4]); }
  return pts;
}
// "<3" and common heart characters become the heart glyph; everything is uppercased; unknown characters become spaces
export function normalize(text) {
  return String(text ?? '').replace(/<3/g, '♥').replace(/[❤♡♥]️?/g, '♥').replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\.\.\./g, '…')
    .toUpperCase().split(/\n|\|/).map(l => [...l.trim()].map(c => (c === ' ' || glyph(c) ? c : ' ')).join('').replace(/ +/g, ' ').trim()).filter(l => l.length);
}
export function lineWidth(line) { let w = 0, n = 0; for (const c of line) { w += c === ' ' ? SPACE : glyph(c).w; n++; } return w + GAP * Math.max(0, n - 1) - (line.includes(' ') ? GAP * 2 * (line.split(' ').length - 1) : 0); }

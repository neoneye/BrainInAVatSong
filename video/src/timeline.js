// timeline.js: the shot list. Each shot runs from its t0 to the next shot's t0 (snapped to the beat).
//   scene    module in src/scenes/, mode and other parameters are passed through to the scene
//   behind   { scene, mode }: another scene rendered first and handed to this one as `backdrop`
//   trans    cross-fade length from the previous shot (s, default 0 = hard cut; only between different scenes)
//   grade    { vignette, grain, fringe, sat, tint } for the post pass
//   fmt      subtitle format override (fog | label | note | karaoke | term | caption), subs: false hides them
//   fx(t, info) → { flash, flashCol, glitch, flicker, dark } per-frame post effects
import { BEAT, BEAT0 } from './audio.js';

const b = t => BEAT0 + Math.round((t - BEAT0) / BEAT) * BEAT;   // snap to the nearest beat
const hash = n => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

// post effects
const tube = (t) => ({ flicker: hash(Math.floor(t * 30)) < 0.035 ? 0.35 : 0 });                       // a bad fluorescent tube
const hits = (t, s) => ({ glitch: s.onset > 1.15 ? 0.22 : 0, flash: s.lt < 0.1 ? 0.35 * (1 - s.lt / 0.1) : 0, flashCol: [0.8, 1, 0.85] });
const simfx = (t, s) => ({ glitch: hash(Math.floor(t * 12)) < 0.05 ? 0.3 : 0 });
const cutflash = (t, s) => ({ flash: s.lt < 0.14 ? 0.7 * (1 - s.lt / 0.14) : 0 });
const crash = hit => (t, s) => ({ flash: s.lt > hit && s.lt < hit + 0.22 ? 0.9 * (1 - (s.lt - hit) / 0.22) : 0, glitch: s.lt > hit && s.lt < hit + 0.8 ? 0.5 * (1 - (s.lt - hit) / 0.8) : 0 });
const fadeout = (t, s) => ({ dark: Math.max(0, (s.p - 0.75) / 0.25) });

const LAB = { vignette: 0.6, grain: 0.08, fringe: 0.005 }, SIM = { vignette: 0.12, grain: 0.03, fringe: 0.008, sat: 1.15 };
const WARM = { vignette: 0.3, grain: 0.04, fringe: 0.002, tint: [1.05, 1, 0.93] }, COLD = { vignette: 0.7, grain: 0.1, fringe: 0.006, sat: 0.7, tint: [0.9, 1, 1.05] };
const PAPER = { vignette: 0.5, grain: 0.05, fringe: 0.002 };
const lab = (mode, o = {}) => ['lab', { mode, grade: LAB, fx: tube, ...o }];
const sim = (mode, o = {}) => ['sim', { mode, grade: SIM, fx: simfx, ...o }];
const water = (text, o = {}) => ['water', { text, grade: PAPER, fx: hits, fmt: 'caption', ...o }]   // the painted words are the big type; plain captions under them;
const ink = (text, mode, o = {}) => ['ink', { text, mode, grade: PAPER, ...o }];
const dust = (text, mode = 'write', o = {}) => ['dust', { text, mode, behind: { scene: 'lab', mode: 'dusty' }, grade: LAB, ...o }];
const DUSTY = { scene: 'lab', mode: 'dusty' };

const S = [
  // ── Intro: the shelves, a message in the dust ──
  [0, ...lab('rows', { fx: (t, s) => ({ dark: Math.max(0, 1 - s.lt / 3) }) })],
  [8.3, ...dust('WOULD YOU\nWANT ME', 'write', { trans: 1.2 })],
  [17.3, ...lab('wide', { trans: 1 })],
  [24.2, ...dust('', 'heart')],
  [30.2, ...lab('gaze')],
  // ── Verse 1 ──
  [34.0, ...lab('her')],
  [40.9, ...lab('kiss')],
  [44.3, ...lab('nurse', { grade: COLD })],
  [46.6, ...lab('him')],
  [54.2, ...lab('her', { cam: 1 })],
  [58.5, ...lab('gaze', { cam: 1 })],
  [62.3, ...lab('leak')],
  [65.9, ...ink('Stay wet, baby', 'wick')],
  [69.2, ...lab('him', { cam: 1 })],
  [72.6, ...lab('her')],
  // ── Pre-chorus ──
  [76.2, ...lab('gaze')],
  [79.1, ...lab('wide', { cam: 1 })],
  [82.5, ...ink('whatever makes me\nfeel this way', 'drops', { seed: 7, fmt: 'caption' })],
  [86.5, ...lab('kiss', { cam: 1 })],
  // ── Chorus 1 ──
  [91.7, ...water('TOUCH ME', { fx: (t, s) => ({ ...hits(t, s), ...cutflash(t, s) }) })],
  [95.2, ...sim('dance', { cam: 0 })],
  [98.5, ...water('FEED\nTHE FIRE', { seed: 2 })],
  [102.1, ...lab('gaze', { cam: 2, fx: hits })],
  [105.4, ...sim('dance', { cam: 1 })],
  [108.1, ...sim('dance', { cam: 2 })],
  [111.2, ...water('ONE MORE\nNIGHT', { seed: 3 })],
  [115.0, ...lab('kiss', { fx: hits })],
  [118.4, ...water('WANTING\nMORE', { mode: 'drip', seed: 4, fx: undefined })],
  // ── Synth solo ──
  [126.9, ...lab('rows', { cam: 1 })],
  [130.3, ...lab('wide', { cam: 2 })],
  // ── Verse 2: the simulation ──
  [132.9, ...sim('beach', { fx: cutflash })],
  [136.3, ...sim('shirt')],
  [139.5, ...sim('sunrise')],
  [142.9, ...lab('lightson', { grade: COLD })],
  [144.7, ...lab('nurse', { grade: COLD, cam: 1 })],
  [146.3, ...dust('IN REAL\nLIFE?', 'write', { seed: 5 })],
  [149.7, ...ink('I’d find your shelf\nand make you my wife', 'wick', { seed: 3 })],
  [153.1, ...sim('wipe')],
  [156.5, ...lab('her', { cam: 2 })],
  // ── Pre-chorus 2 ──
  [159.8, ...ink('a kiss\nthey didn’t save', 'soak', { seed: 11, ink: 'red', fmt: 'caption' })],
  [165.9, ...sim('sunset', { grade: WARM, fx: undefined, trans: 0.8 })],
  // ── Chorus 2 ──
  [175.3, ...water('TAKE ME\nHIGHER', { seed: 5, fx: (t, s) => ({ ...hits(t, s), ...cutflash(t, s) }) })],
  [178.8, ...sim('dance', { cam: 1 })],
  [182.1, ...lab('kiss', { cam: 2, fx: hits })],
  [185.6, ...water('MORNING\nLIGHT', { seed: 6 })],
  [188.9, ...sim('dance', { cam: 2 })],
  [191.6, ...lab('gaze', { fx: hits })],
  [195.4, ...water('REMEMBER', { seed: 7, mode: 'flood' })],
  [198.5, ...sim('dance', { cam: 0 })],
  // ── Rap: his console ──
  [202.4, 'terminal', { mode: 'rap', grade: LAB, fx: hits }],
  [209.06, ...lab('him', { cam: 2 })],
  [210.9, 'terminal', { mode: 'rap', grade: LAB, fx: hits }],
  [219.2, ...lab('curtain')],
  [222.6, 'terminal', { mode: 'rap', grade: LAB, fx: hits }],
  [226.0, ...lab('shelf')],
  // ── Bridge: fingers, no glass, no wires ──
  [230.3, ...sim('hands', { grade: WARM, fx: undefined, glitch: 0, trans: 1 })],
  [237.2, ...sim('embrace', { grade: WARM, fx: undefined })],
  // ── The nightmare ──
  [251.2, ...lab('empty', { grade: COLD, fx: (t, s) => ({ ...tube(t), flash: s.lt < 0.1 ? 0.5 : 0 }) })],
  [256.2, 'shatter', { mode: 'fall', hit: 2.6, grade: COLD, fx: crash(2.6) }],
  [261.3, ...sim('kiss', { fx: (t, s) => ({ glitch: 0.25 + 0.4 * hash(Math.floor(t * 15)) }) })],
  [265.5, 'shatter', { mode: 'floor', grade: COLD, fx: tube }],
  [272.2, 'shatter', { mode: 'shards', cam: 0, grade: LAB, fx: hits }],
  // ── Final chorus ──
  [276.06, ...water('TOUCH ME', { seed: 8, fx: (t, s) => ({ ...hits(t, s), ...cutflash(t, s) }) })],
  [279.7, ...sim('kiss')],
  [283.1, 'shatter', { mode: 'shards', cam: 1, grade: LAB, fx: hits }],
  [284.8, ...lab('kiss', { fx: hits })],
  [286.5, ...water('KEEP ME UP', { seed: 9 })],
  [289.9, ...sim('dance', { cam: 1 })],
  [292.6, ...lab('gaze', { cam: 1, fx: hits })],
  [295.7, ...sim('kiss', { cam: 1 })],
  [299.5, ...water('BREATHLESS', { seed: 10, mode: 'flood' })],
  [304.4, 'shatter', { mode: 'shards', cam: 2, grade: LAB, fx: hits }],
  [309.5, ...water('WANTING\nMORE', { mode: 'drip', seed: 12, fx: undefined })],
  // ── Outro ──
  [316.3, ...lab('wide', { trans: 1.2 })],
  [322.8, ...dust('WOULD YOU WANT ME\nIN REAL LIFE?', 'write', { seed: 9, trans: 1 })],
  [334.2, ...lab('dark', { trans: 1.5, fx: fadeout })],
];

export const SHOTS = S.map(([t0, scene, o], i) => ({ t0: i === 0 ? 0 : b(t0), scene, seed: i + 1, ...o }));

// overlay.js: the subtitles, drawn on a 2D canvas that is laid over the graded frame. Each lyric line carries a
// format (`fmt` in lyrics.js; a shot can override it with `fmt`, or hide subtitles with `subs: false`):
//   fog      whispered lines: breath on cold glass, soft and blurred, one word condensing at a time
//   label    verses: a typed specimen label taped to the picture, the sung word struck with red marker
//   note     pre-chorus: handwriting that writes itself on as it is sung
//   karaoke  choruses: big serif capitals that fill with blood red, the sung word white and kicked by the beat
//   term     the rap: a green shell prompt typing the words
//   caption  the bridge: plain small film captions
import { LYRICS } from './lyrics.js';
import { W, H } from './engine.js';

export const MONO = '"IBM Plex Mono", Menlo, monospace', HAND = '"Caveat", cursive', SERIF = '"Playfair Display", Georgia, serif';
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = x => x * x * (3 - 2 * x);

function activeLine(t) {
  // A line shows from just before its first word until the next line takes over, or fades after a pause.
  for (let i = 0; i < LYRICS.length; i++) {
    const L = LYRICS[i], next = LYRICS[i + 1], start = L.t0 - 0.3;
    const hold = L.fmt === 'fog' ? 2.2 : 0.9;
    const end = next && next.t0 - 0.3 < L.t1 + hold ? next.t0 - 0.3 : L.t1 + hold;
    if (t >= start && t < end) return { L, i, age: t - start, left: end - t };
  }
  return null;
}

// Break the words into rows no wider than maxW; returns rows of { w (text), i (word index), x, width } centred on cx.
function layout(c, words, maxW, cx, gap) {
  const sp = gap ?? c.measureText(' ').width, rows = [[]]; let x = 0;
  words.forEach((w, i) => {
    const width = c.measureText(w).width;
    if (x > 0 && x + width > maxW) { rows.push([]); x = 0; }
    rows[rows.length - 1].push({ w, i, x, width }); x += width + sp;
  });
  if (rows.length === 2 && rows[1].length <= 1 && rows[0].length > 3) {  // no orphan word on the second row
    const moved = rows[0].pop(); rows[1].unshift(moved); let xx = 0; for (const it of rows[1]) { it.x = xx; xx += it.width + sp; }
  }
  for (const r of rows) { const tw = r[r.length - 1].x + r[r.length - 1].width; for (const it of r) it.x += cx - tw / 2; r.width = tw; }
  return rows;
}
const state = (t, [, a, b]) => (t < a ? 0 : t < b + 0.05 ? 1 : 2);  // 0 = to come, 1 = being sung, 2 = sung

function fog(c, t, a) {
  const { L } = a, size = 92;
  c.font = `italic 400 ${size}px ${SERIF}`; c.textBaseline = 'middle';
  const rows = layout(c, L.words.map(w => w[0]), W * 0.8, W / 2, size * 0.45), y0 = H - 190 - (rows.length - 1) * size * 0.6;
  const out = clamp(a.left / 1.6);
  rows.forEach((r, ri) => r.forEach(it => {
    const [, wa] = L.words[it.i], k = clamp((t - wa + 0.15) / 0.7);
    if (k <= 0) return;
    const y = y0 + ri * size * 1.2 + (1 - ease(k)) * 8 + (1 - out) * 26;  // the breath sags as it fades
    c.save();
    c.filter = `blur(${(14 * (1 - ease(k)) + 2.2 + (1 - out) * 10).toFixed(1)}px)`;
    c.globalAlpha = 0.5 * ease(k) * out; c.fillStyle = '#cfe6dc'; c.fillText(it.w, it.x, y);
    c.filter = 'none'; c.globalAlpha = 0.5 * ease(k) * out * out; c.fillStyle = '#eef6f0'; c.fillText(it.w, it.x, y);
    c.restore();
  }));
}

function label(c, t, a) {
  const { L, i } = a, size = 44;
  c.font = `700 ${size}px ${MONO}`; c.textBaseline = 'middle';
  const rows = layout(c, L.words.map(w => w[0]), W * 0.62, 0), lh = size * 1.42;
  const tw = Math.max(...rows.map(r => r.width)), bw = tw + 90, bh = rows.length * lh + 78;
  const k = ease(clamp(Math.min(a.age / 0.22, a.left / 0.18)));
  const rot = ((i * 37) % 7 - 3) * 0.004, cx = W / 2 + ((i * 53) % 9 - 4) * 14, cy = H - 60 - bh / 2;
  c.save(); c.translate(cx, cy + (1 - k) * 40); c.rotate(rot); c.globalAlpha = k;
  c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 24; c.shadowOffsetY = 8;
  c.fillStyle = '#d9d4bf'; c.fillRect(-bw / 2, -bh / 2, bw, bh);
  c.shadowColor = 'transparent';
  c.fillStyle = 'rgba(190,180,150,.55)'; c.fillRect(-bw / 2 - 26, -bh / 2 + 10, 60, 30); c.fillRect(bw / 2 - 34, bh / 2 - 40, 60, 30);  // tape
  c.strokeStyle = '#7b1c14'; c.lineWidth = 3; c.strokeRect(-bw / 2 + 10, -bh / 2 + 10, bw - 20, bh - 20);
  c.font = `400 19px ${MONO}`; c.fillStyle = '#7b1c14';
  c.fillText(`SPECIMEN ${L.who === 'him' ? '0418-M' : '0417-F'}  ·  ${L.sec.toUpperCase()}  ·  DO NOT SHAKE`, -bw / 2 + 28, -bh / 2 + 34);
  c.font = `700 ${size}px ${MONO}`;
  rows.forEach((r, ri) => r.forEach(it => {
    const s = state(t, L.words[it.i]), x = it.x, y = -bh / 2 + 62 + lh * (ri + 0.5);
    if (s === 1) { c.fillStyle = 'rgba(200,30,20,.85)'; c.fillRect(x - 7, y - size * 0.56, it.width + 14, size * 1.12); c.fillStyle = '#f4efdc'; }
    else c.fillStyle = s === 2 ? '#15130f' : 'rgba(21,19,15,.34)';
    c.fillText(it.w, x, y + 2);
  }));
  c.restore();
}

function note(c, t, a) {
  const { L, i } = a, size = 104;
  c.font = `700 ${size}px ${HAND}`; c.textBaseline = 'middle';
  const rows = layout(c, L.words.map(w => w[0]), W * 0.84, W / 2), y0 = H - 150 - (rows.length - 1) * size * 0.5;
  const out = clamp(a.left / 0.5);
  c.save(); c.translate(W / 2, y0); c.rotate(((i * 29) % 5 - 2) * 0.006 - 0.012); c.translate(-W / 2, -y0);
  c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = 14;
  rows.forEach((r, ri) => r.forEach(it => {
    const [, wa, wb] = L.words[it.i], k = clamp((t - wa) / Math.max(0.12, wb - wa)), y = y0 + ri * size * 0.95;
    if (k <= 0) return;
    c.save(); c.beginPath(); c.rect(it.x - 10, y - size, (it.width + 20) * k, size * 2); c.clip();  // the pen moves left to right
    c.globalAlpha = out; c.lineJoin = 'round'; c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 12; c.strokeText(it.w, it.x, y);
    c.fillStyle = k < 1 ? '#fff6c8' : '#e9e2c6'; c.fillText(it.w, it.x, y);
    c.restore();
    if (k > 0 && k < 1) {  // scribbled underline under the word being written
      c.strokeStyle = '#c8281c'; c.lineWidth = 5; c.lineCap = 'round'; c.globalAlpha = out; c.beginPath();
      for (let q = 0; q <= 12; q++) { const u = q / 12 * k; c.lineTo(it.x + it.width * u, y + size * 0.44 + Math.sin(u * 19 + it.i) * 4); }
      c.stroke(); c.globalAlpha = 1;
    }
  }));
  c.restore();
}

function karaoke(c, t, a, beat) {
  const { L } = a, size = 80;
  c.font = `700 ${size}px ${SERIF}`; c.textBaseline = 'middle'; c.lineJoin = 'round';
  const words = L.words.map(w => w[0].toUpperCase());
  const rows = layout(c, words, W * 0.9, W / 2, size * 0.34), y0 = H - 128 - (rows.length - 1) * size * 1.1;
  const k = clamp(Math.min(a.age / 0.15, a.left / 0.25));
  rows.forEach((r, ri) => r.forEach(it => {
    const s = state(t, L.words[it.i]), [, wa] = L.words[it.i], hit = s === 1 ? Math.exp(-(t - wa) * 7) : 0;
    const y = y0 + ri * size * 1.1, sc = 1 + 0.16 * hit + (s === 1 ? 0.04 * beat.pulse : 0);
    c.save(); c.translate(it.x + it.width / 2, y); c.scale(sc, sc); c.rotate(s === 1 ? (it.i % 2 ? 1 : -1) * 0.02 * hit : 0); c.globalAlpha = k;
    c.strokeStyle = 'rgba(0,0,0,.92)'; c.lineWidth = 16; c.strokeText(it.w, -it.width / 2, 0);
    if (s === 0) { c.strokeStyle = '#b3261b'; c.lineWidth = 3; c.strokeText(it.w, -it.width / 2, 0); }
    else {
      if (s === 1) { c.shadowColor = '#ff3a2a'; c.shadowBlur = 40; }
      c.fillStyle = s === 1 ? '#fff' : '#ff8d7e'; c.fillText(it.w, -it.width / 2, 0);
    }
    c.restore();
  }));
}

function term(c, t, a) {
  const { L } = a, size = 46;
  c.font = `700 ${size}px ${MONO}`; c.textBaseline = 'middle';
  const prompt = 'him@vat-0418:~$ ', pw = c.measureText(prompt).width, cw = c.measureText('M').width;
  // typed text: each word's letters appear across the time it is pronounced
  let typed = '';
  for (const [w, wa, wb] of L.words) { const k = clamp((t - wa) / Math.max(0.08, (wb - wa) * 0.8)); if (k <= 0) break; typed += (typed ? ' ' : '') + w.slice(0, Math.ceil(w.length * k)); }
  const maxChars = Math.floor((W - 160 - pw) / cw), lines = [];
  let cur = '';
  for (const w of typed.split(' ')) { if ((cur + ' ' + w).trim().length > maxChars) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  lines.push(cur);
  const lh = size * 1.3, bh = lines.length * lh + 36, y0 = H - 50 - bh;
  c.fillStyle = 'rgba(0,10,3,.84)'; c.fillRect(60, y0, W - 120, bh);
  c.strokeStyle = 'rgba(70,255,120,.5)'; c.lineWidth = 2; c.strokeRect(60, y0, W - 120, bh);
  c.shadowColor = '#3f8'; c.shadowBlur = 12;
  lines.forEach((ln, i) => {
    const y = y0 + 18 + lh * (i + 0.5);
    c.fillStyle = '#1f9d4b'; if (i === 0) c.fillText(prompt, 84, y);
    c.fillStyle = '#7dffa6'; c.fillText(ln, 84 + pw, y);
    if (i === lines.length - 1 && Math.floor(t * 4) % 2 === 0) c.fillRect(84 + pw + c.measureText(ln).width + 6, y - size * 0.5, cw * 0.9, size);
  });
  c.shadowBlur = 0;
}

function caption(c, t, a) {
  const { L } = a, size = 52;
  c.font = `400 ${size}px ${SERIF}`; c.textBaseline = 'middle'; c.lineJoin = 'round';
  const rows = layout(c, L.words.map(w => w[0]), W * 0.8, W / 2), y0 = H - 110 - (rows.length - 1) * size * 1.25;
  c.globalAlpha = clamp(Math.min(a.age / 0.4, a.left / 0.5));
  rows.forEach((r, ri) => r.forEach(it => {
    const s = state(t, L.words[it.i]), y = y0 + ri * size * 1.25;
    c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineWidth = 7; c.strokeText(it.w, it.x, y);
    c.fillStyle = s === 0 ? 'rgba(255,255,255,.45)' : '#fff'; c.fillText(it.w, it.x, y);
  }));
  c.globalAlpha = 1;
}

const FORMATS = { fog, label, note, karaoke, term, caption };

export function drawOverlay(c, t, info) {
  if (info.subs === false) return;
  const a = activeLine(t);
  if (!a) return;
  c.save();
  (FORMATS[info.fmt || a.L.fmt] || caption)(c, t, a, info.beat);
  c.restore();
}

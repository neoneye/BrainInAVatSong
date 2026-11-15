// terminal.js: the rap break. His console: a green phosphor CRT where he types the things the rap describes:
// `touch you` makes an empty file, there is no `buy ring`, the tank status, her laughter blanking the screen, the
// nurse denying the fluid swap, a ping that takes its time. Everything is keyed to the word timings in lyrics.js.
// Modes: `rap` (the scripted console), `idle` (prompt and blinking cursor only).
import { LYRICS } from '../lyrics.js';

export const meta = { modes: ['rap', 'idle'] };

const RAP = LYRICS.filter(L => L.sec === 'Rap');
const at = (line, word, end = false) => RAP[line].words[Math.min(word, RAP[line].words.length - 1)][end ? 2 : 1];
const PROMPT = 'him@vat-0418:~$ ';
// script: cmd = typed between t0 and t1; out = printed at t0. `clear` wipes the screen, `off`/`on` the tube.
const SCRIPT = [
  { cmd: 'touch you', t0: at(0, 1), t1: at(0, 5, true) },
  { out: 'touch: sensation not supported on this device', t0: at(0, 7), warn: 1 },
  { cmd: 'ls -l', t0: at(0, 9), t1: at(0, 11) },
  { out: '-rw-r--r--  1 him  brains     0 Nov 15 03:14 you', t0: at(0, 11, true) },
  { cmd: 'file you', t0: at(1, 1), t1: at(1, 4) },
  { out: 'you: empty', t0: at(1, 4, true) },
  { cmd: 'buy ring', t0: at(1, 7), t1: at(1, 11) },
  { out: 'bash: buy: command not found', t0: at(1, 11, true), warn: 1 },
  { clear: 1, t0: at(2, 0) },
  { out: '<her> talk dirty.', t0: at(2, 2), her: 1 },
  { cmd: 'tank --status', t0: at(2, 5), t1: at(2, 8) },
  { out: 'FLUID LEVEL  [##############......]  71 %', t0: at(2, 8, true) },
  { out: 'TEMPERATURE  36.9 C     pH 7.31', t0: at(2, 8, true) + 0.15 },
  { out: 'TURBIDITY    filthy', t0: at(2, 8, true) + 0.3, warn: 1 },
  { out: '<her> HA', t0: at(3, 1), her: 1, laugh: [at(3, 1), at(3, 6)] },
  { off: 1, t0: at(3, 7) },
  { on: 1, t0: at(4, 0) - 0.25 },
  { cmd: 'sudo swap --fluids her him', t0: at(4, 1), t1: at(4, 3, true) },
  { out: '[sudo] password for nurse:', t0: at(4, 4) },
  { out: 'PERMISSION DENIED', t0: at(4, 7), warn: 2 },
  { clear: 1, t0: at(6, 0) - 0.2 },
  { out: '<her> coming over.', t0: at(6, 2), her: 1 },
  { cmd: 'ping her', t0: at(6, 5), t1: at(6, 7) },
  { out: '64 bytes from her: shelf_seq=1 time=forever', t0: at(6, 8) },
  { out: '64 bytes from her: shelf_seq=2 time=forever', t0: at(6, 9) },
  { out: '64 bytes from her: shelf_seq=3 time=forever', t0: at(6, 9, true) },
];

export async function create({ width: W, height: H }) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const glow = document.createElement('canvas'); glow.width = W / 4; glow.height = H / 4; const g = glow.getContext('2d');
  const SIZE = 54, LH = 74, X0 = 150, Y0 = 150, ROWS = 9;

  function screen(t, mode) {
    // rebuild the visible lines from the script up to time t
    let lines = [], power = 1;
    if (mode !== 'idle') for (const e of SCRIPT) {
      if (t < e.t0) break;
      if (e.clear) lines = [];
      else if (e.off) power = Math.max(0, 1 - (t - e.t0) / 0.28);
      else if (e.on) { lines = []; power = Math.min(1, (t - e.t0) / 0.2); }
      else if (e.cmd) { const k = Math.min(1, (t - e.t0) / Math.max(0.1, e.t1 - e.t0)); lines.push({ text: PROMPT + e.cmd.slice(0, Math.ceil(e.cmd.length * k)), cursor: k < 1 }); }
      else if (e.laugh) { const k = Math.min(1, (t - e.laugh[0]) / (e.laugh[1] - e.laugh[0])), n = Math.floor(k * 150); let s = '<her> '; for (let i = 0; i < n; i++) { s += 'HA'; if (s.length > 44) { lines.push({ text: s, her: 1 }); s = '      '; } } lines.push({ text: s, her: 1 }); }
      else lines.push({ text: e.out, warn: e.warn, her: e.her, age: t - e.t0 });
    }
    const last = lines[lines.length - 1];
    if (!last || !last.cursor) lines.push({ text: PROMPT, cursor: true, idle: true });
    return { lines: lines.slice(-ROWS), power };
  }

  return {
    canvas,
    update(t, s) {
      const { lines, power } = screen(t, s.mode), pulse = s.beat.pulse;
      c.fillStyle = '#010502'; c.fillRect(0, 0, W, H);
      c.save();
      // slow push-in with a little beat shake
      const z = 1.02 + 0.05 * Math.min(1, s.p || 0) + 0.006 * pulse; c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-W / 2, -H / 2);
      if (power < 1) { const sy = Math.max(0.004, power * power), sx = Math.min(1, power * 3 + 0.02); c.translate(W / 2, H / 2); c.scale(sx, sy); c.translate(-W / 2, -H / 2); }
      // tube face
      const grd = c.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.62); grd.addColorStop(0, '#06200f'); grd.addColorStop(1, '#010a04');
      c.fillStyle = grd; c.beginPath(); c.roundRect(70, 60, W - 140, H - 300, 60); c.fill();
      c.font = `700 ${SIZE}px "IBM Plex Mono"`; c.textBaseline = 'middle';
      lines.forEach((ln, i) => {
        const y = Y0 + i * LH + 30;
        c.fillStyle = ln.warn === 2 ? (Math.floor(t * 8) % 2 ? '#ff5340' : '#7a1c12') : ln.warn ? '#ffb347' : ln.her ? '#ff9ad5' : '#69ff9b';
        if (ln.warn === 2) { c.font = `700 ${SIZE * 1.5}px "IBM Plex Mono"`; c.fillText(ln.text, X0, y + 16); c.font = `700 ${SIZE}px "IBM Plex Mono"`; }
        else c.fillText(ln.text, X0, y);
        if (ln.cursor && Math.floor(t * 3.5) % 2 === 0) c.fillRect(X0 + c.measureText(ln.text).width + 6, y - SIZE * 0.5, SIZE * 0.55, SIZE);
      });
      c.restore();
      // phosphor bloom
      g.clearRect(0, 0, glow.width, glow.height); g.filter = 'blur(6px)'; g.drawImage(canvas, 0, 0, glow.width, glow.height); g.filter = 'none';
      c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55 + 0.25 * pulse; c.drawImage(glow, 0, 0, W, H); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
      // scanlines and a rolling bar
      c.fillStyle = 'rgba(0,0,0,.28)'; for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 2);
      const bar = ((t * 0.21) % 1) * (H + 300) - 150; const bg = c.createLinearGradient(0, bar - 120, 0, bar + 120);
      bg.addColorStop(0, 'rgba(120,255,160,0)'); bg.addColorStop(0.5, 'rgba(120,255,160,.07)'); bg.addColorStop(1, 'rgba(120,255,160,0)');
      c.fillStyle = bg; c.fillRect(0, bar - 120, W, 240);
    },
  };
}

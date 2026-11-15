// thumbs.js: three YouTube thumbnail candidates (1280×720), each built from frames of the video's scenes with type on top.
// Open video/thumbs.html in the player server to see them, or `node video/render.mjs --thumbs=out/thumbs` to save PNGs.
import { Engine, W, H } from './engine.js';
import { SERIF, MONO } from './overlay.js';

const TW = 1280, TH = 720, RED = '#ff4a3a';

// Renders one scene frame (no lyrics) and returns it as a 1920×1080 canvas.
const engines = {};
async function still(shot, t) {
  const key = shot.scene;
  if (!engines[key]) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    engines[key] = new Engine(cv, [{ t0: 0, ...shot }], { lyrics: false });
    await engines[key].load([shot.scene]);
  }
  const e = engines[key]; e.shots = [{ t0: 0, seed: 1, ...shot }];
  e.frame(t);
  const copy = document.createElement('canvas'); copy.width = W; copy.height = H;
  copy.getContext('2d').drawImage(e.canvas, 0, 0);
  return copy;
}

// outlined type with a soft dark halo so it holds on any picture
function type(c, txt, x, y, size, { font = SERIF, weight = 700, fill = '#fff', align = 'left', italic = false, stroke = 'rgba(0,0,0,.9)' } = {}) {
  c.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`; c.textBaseline = 'middle'; c.textAlign = align; c.lineJoin = 'round';
  c.shadowColor = 'rgba(0,0,0,.9)'; c.shadowBlur = size * 0.35;
  c.strokeStyle = stroke; c.lineWidth = size * 0.16; c.strokeText(txt, x, y);
  c.shadowBlur = 0; c.fillStyle = fill; c.fillText(txt, x, y); c.textAlign = 'left';
}
function shade(c, x0, y0, x1, y1, a = 0.85) {  // dark gradient from (x0,y0) fading out at (x1,y1)
  const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, TW, TH);
}
function cover(c, img, zoom = 1, cx = 0.5, cy = 0.5) {  // draw a 16:9 still to fill the thumbnail, optionally zoomed
  const sw = W / zoom, sh = H / zoom, sx = (W - sw) * cx, sy = (H - sh) * cy;
  c.drawImage(img, sx, sy, sw, sh, 0, 0, TW, TH);
}

export const THUMBS = [
  {
    // 1: the two brains, eyes locked through the glass, the song's question underneath
    name: 'thumb1_two_jars',
    async draw(c) {
      cover(c, await still({ scene: 'lab', mode: 'gaze', t1: 8 }, 3.2), 1.0);
      shade(c, 0, TH, 0, TH * 0.45, 0.92);
      type(c, 'WOULD YOU WANT ME', TW / 2, TH - 168, 92, { align: 'center' });
      type(c, 'IN REAL LIFE?', TW / 2, TH - 70, 104, { align: 'center', fill: RED });
    },
  },
  {
    // 2: the nightmare: the jar marked YOU in pieces
    name: 'thumb2_marked_with_you',
    async draw(c) {
      cover(c, await still({ scene: 'shatter', mode: 'shards', cam: 2, t1: 8 }, 2.6), 1.0);
      shade(c, 0, 0, 0, TH * 0.4, 0.8); shade(c, 0, TH, 0, TH * 0.55, 0.9);
      type(c, 'TWO EMPTY JARS', 48, 78, 84);
      type(c, 'ONE WAS MARKED', TW - 48, TH - 150, 76, { align: 'right' });
      type(c, 'WITH YOU', TW - 48, TH - 62, 100, { align: 'right', fill: '#8dff9a' });
    },
  },
  {
    // 3: love text in water, with her looking out of the jar
    name: 'thumb3_touch_me',
    async draw(c) {
      c.filter = 'brightness(1.7) saturate(1.15)';
      cover(c, await still({ scene: 'water', text: 'TOUCH\nME', mode: 'paint', seed: 3, t1: 8 }, 2.4), 1.0);
      c.filter = 'none';
      const her = await still({ scene: 'lab', mode: 'her', t1: 8 }, 3.0), R = 190, cx = TW - 230, cy = TH - 240, sq = H * 0.92;
      c.save(); c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();
      c.drawImage(her, W * 0.5 - sq * 0.5, H * 0.02, sq, sq, cx - R, cy - R, 2 * R, 2 * R);
      c.restore();
      c.strokeStyle = '#d43a2c'; c.lineWidth = 9; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
      type(c, 'a love song for two brains in jars', 44, TH - 48, 44, { italic: true, weight: 400 });
    },
  },
];

const ready = Promise.all(['700 50px ' + SERIF, '400 50px ' + SERIF, 'italic 400 50px ' + SERIF, '700 50px ' + MONO, '700 50px Caveat'].map(f => document.fonts.load(f)));
window.THUMBS = THUMBS;
window.renderThumb = async i => {
  await ready;
  const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
  const c = cv.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, TW, TH);
  await THUMBS[i].draw(c);
  return { name: THUMBS[i].name, url: cv.toDataURL('image/png'), canvas: cv };
};
window.ready = true;
if (!new URLSearchParams(location.search).has('render')) {
  for (let i = 0; i < THUMBS.length; i++) document.body.appendChild((await window.renderThumb(i)).canvas);
}

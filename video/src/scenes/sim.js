// sim.js: "the simulation": the fake beach world the two brains are fed. Too bright, too clean, and it glitches.
// Two mannequins with brains for heads (SHE: pale pink brain, red dress; HE: darker brain, shirt and shorts).
//
// Modes (shot.mode): beach, shirt, dance, sunrise, sunset, wipe, hands, embrace, kiss      (see `meta` and the report)
// Shot params: cam (dance: 0 wide, 1 her, 2 him/orbit), seed, glitch (0..1 multiplier, default 1).
// Test-only params for `?scene=sim` (where the whole song is one shot): off = song time at which the shot "starts",
// span = pretend shot length in seconds, e.g. --q="scene=sim&mode=shirt&off=136&span=7" --sheet=136,137,…
import * as THREE from 'three';
import { BEAT, BEAT0 } from '../audio.js';
import { voiceAt } from '../engine.js';
import { makeFigure, lerpPose, ANKLE } from './sim/figure.js';
import { buildWorld, gy } from './sim/world.js';
import { hash, rngOf } from './sim/brain.js';

export const meta = {
  modes: ['beach', 'shirt', 'dance', 'sunrise', 'sunset', 'wipe', 'hands', 'embrace', 'kiss'],
  params: { look: 'optional override of the lighting preset: day, dusk, sunset, night, sunrise, golden, morning', cam: 'dance: 0 wide, 1 close on her, 2 orbit on him', seed: 'variation', glitch: '0..1 glitch amount multiplier (default 1)', off: 'test only: shot start in song time', span: 'test only: shot length' },
};

const PI = Math.PI, clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), mix = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

const LOOKS = {
  day:     { top: 0x0a55ff, hor: 0x9ff2ff, sunCol: 0xfffff0, sunCol2: 0xffee88, el: 46, az: 38, R: 0.045, glow: 0.3, band: 14, sunI: 3.4, sunC: 0xfff6dc, hemiS: 0xd6f0ff, hemiG: 0xffe6a8, hemiI: 2.3, deep: 0x0a66e6, shal: 0x10f2d6, sunPow: 160, sunAmt: 0.7, cloud: 0x666666 },
  dusk:    { gexp: 0.3, top: 0x2a14a8, hor: 0xff7a4a, sunCol: 0xffe070, sunCol2: 0xff3a2a, el: 1.6, az: -16, R: 0.085, glow: 0.55, band: 9, sunI: 2.0, sunC: 0xff7a40, hemiS: 0x8a78ff, hemiG: 0x6a4a90, hemiI: 1.7, deep: 0x1a148a, shal: 0x9a3ab0, sunPow: 26, sunAmt: 1.1, cloud: 0x5a2040 },
  sunset:  { gexp: 0.35, top: 0x5a1a9a, hor: 0xff7a1a, sunCol: 0xfff3a8, sunCol2: 0xff4a10, el: 3.6, az: 0, R: 0.2, glow: 0.45, band: 9, sunI: 2.6, sunC: 0xff7a30, hemiS: 0x7a3aa0, hemiG: 0x702810, hemiI: 0.22, deep: 0x3a1070, shal: 0xc8408a, sunPow: 10, sunAmt: 1.2, cloud: 0x55183a },
  night:   { gexp: 0.35, stars: 1, top: 0x05042a, hor: 0x4a1a90, sunCol: 0xff80c0, sunCol2: 0xff3090, el: -9, az: 0, R: 0.05, glow: 0, band: 8, sunI: 0, sunC: 0xffffff, hemiS: 0x8a80ff, hemiG: 0x604080, hemiI: 2.8, deep: 0x08062c, shal: 0x2a1a70, sunPow: 30, sunAmt: 0, cloud: 0x18102c },
  sunrise: { top: 0x2a5ee0, hor: 0xffa878, sunCol: 0xfff6c0, sunCol2: 0xff7a40, el: 2, az: 0, R: 0.075, glow: 0.6, band: 10, sunI: 2.4, sunC: 0xffb070, hemiS: 0xa8b8ff, hemiG: 0xffc0a0, hemiI: 2.6, deep: 0x1840b0, shal: 0xff9a90, sunPow: 22, sunAmt: 1.2, cloud: 0x804050 },
  golden:  { gexp: 0.7, top: 0x3a8cff, hor: 0xffdc9a, sunCol: 0xfff6d0, sunCol2: 0xffb040, el: 9, az: 62, R: 0.06, glow: 0.5, band: 12, sunI: 3.2, sunC: 0xffc070, hemiS: 0xd0dcff, hemiG: 0xffc890, hemiI: 2.3, deep: 0x0a58d0, shal: 0x30e0d0, sunPow: 40, sunAmt: 0.9, cloud: 0x7a5540 },
  morning: { top: 0x5aa8ff, hor: 0xffe2b8, sunCol: 0xfff8e0, sunCol2: 0xffc060, el: 5, az: -22, R: 0.05, glow: 0.7, band: 12, sunI: 1.6, sunC: 0xffc080, hemiS: 0xfff0dc, hemiG: 0xe0a070, hemiI: 2.1, deep: 0x1a70e0, shal: 0x60e8e0, sunPow: 30, sunAmt: 1.0, cloud: 0x806050 },
};

export async function create(ctx) {
  const { width, height } = ctx;
  const W = buildWorld(), scene = W.scene;
  const camera = new THREE.PerspectiveCamera(36, width / height, 0.05, 2500);
  camera.layers.enable(0);

  // clothes textures
  const tex = (draw, rep) => { const c = document.createElement('canvas'); c.width = c.height = 128; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep * 0.6); return t; };
  const shirtTex = tex(c => { c.fillStyle = '#7a22e0'; c.fillRect(0, 0, 128, 128); const r = rngOf(3); for (let i = 0; i < 7; i++) { const x = r() * 128, y = r() * 128; c.fillStyle = i % 2 ? '#ffe640' : '#3affc0'; for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + Math.cos(k * 1.256) * 11, y + Math.sin(k * 1.256) * 11, 8, 0, 7); c.fill(); } c.fillStyle = '#ff4a8a'; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill(); } }, 3);
  const dressTex = tex(c => { c.fillStyle = '#ff2038'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#fff'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.beginPath(); c.arc(16 + i * 32 + (j % 2) * 16, 16 + j * 32, 7, 0, 7); c.fill(); } }, 4);

  const he = makeFigure({ female: false, scale: 1, skin: 0xdba27a, brain: 0xc46c78, seed: 11, top: 0x7a22e0, topMap: shirtTex, bottom: 0xa8f01a, iris: 0x35b0ff, stalk: 0x8a3a48 });
  const she = makeFigure({ female: true, scale: 0.93, skin: 0xf6c8a6, brain: 0xffb4c6, seed: 23, top: 0xff2038, topMap: dressTex, bottom: 0xff2038, iris: 0x30c060, stalk: 0xe07a90, brainSize: 0.255 });
  she.skirt.material.map = dressTex; she.skirt.material.color.set(0xffffff);
  scene.add(he.root, she.root, he.shadow, she.shadow);
  // the shirt as a loose tube while it is being pulled off
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 3, true), he.mats.top.clone()); cloth.material.side = THREE.DoubleSide; cloth.visible = false; scene.add(cloth);
  const clothCap = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), he.mats.top); clothCap.visible = false; scene.add(clothCap);
  W.room.position.set(40, 3.2, -14);
  const figMats = [...Object.values(he.mats), ...Object.values(she.mats), she.skirt.material];

  // own targets + composite/glitch pass
  const mkRT = () => new THREE.WebGLRenderTarget(width, height, { samples: 4, colorSpace: THREE.SRGBColorSpace, type: THREE.UnsignedByteType });
  const rtA = mkRT(), rtB = mkRT();
  const U = {
    tA: { value: rtA.texture }, tB: { value: rtB.texture }, res: { value: new THREE.Vector2(width, height) },
    tear: { value: 0 }, block: { value: 0 }, rgb: { value: 0 }, seed: { value: 0 }, wipe: { value: -1 }, vblock: { value: 0 }, sat: { value: 1.12 }, post: { value: 0 },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, uniforms: U,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      precision highp float; varying vec2 vUv;
      uniform sampler2D tA, tB; uniform vec2 res; uniform float tear, block, rgb, seed, wipe, vblock, sat, post;
      float h1(float n){ return fract(sin(n * 127.1 + seed * 31.7) * 43758.5453); }
      float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed * 3.17) * 43758.5453); }
      void main(){
        vec2 uv = vUv;
        float band = floor(uv.y * res.y / 34.0);
        if (h1(band) < tear) uv.x += (h1(band + 7.0) - 0.5) * 0.22;
        vec2 cell = floor(uv * vec2(12.0, 7.0));
        if (h2(cell) < block) uv += (vec2(h2(cell + 3.0), h2(cell + 7.0)) - 0.5) * 0.25;
        uv = clamp(uv, 0.0, 1.0);
        vec3 a = vec3(texture2D(tA, uv + vec2(rgb, 0.0)).r, texture2D(tA, uv).g, texture2D(tA, uv - vec2(rgb, 0.0)).b);
        if (post > 0.0) a = floor(a * mix(255.0, 5.0, post) + 0.5) / mix(255.0, 5.0, post);
        float l = dot(a, vec3(0.2126, 0.7152, 0.0722)); a = mix(vec3(l), a, sat);
        float m = 0.0, edgeGlow = 0.0;
        if (wipe > -0.5) {
          float row = floor(vUv.y * 27.0);
          float e = wipe * 1.5 - 0.25 + (vUv.y - 0.5) * 0.22 + (h1(row * 0.37 + floor(wipe * 40.0)) - 0.5) * 0.05;
          m = step(vUv.x, e);
          edgeGlow = smoothstep(0.006, 0.0, abs(vUv.x - e)) + 0.35 * smoothstep(0.05, 0.0, vUv.x - e) * step(e, vUv.x);
        }
        if (vblock > 0.0) m = max(m, step(h2(floor(vUv * vec2(8.0, 4.5)) + 11.0), vblock));
        vec3 col = mix(a, texture2D(tB, vUv).rgb, m);
        col = mix(col, vec3(1.0), clamp(edgeGlow, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  quad.frustumCulled = false;
  const qScene = new THREE.Scene(); qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ───────────── poses ─────────────
  const P = (x, z, yaw, y = gy(z)) => ({ pos: [x, y, z], yaw, hip: [0, 0, 0], hipR: [0, 0, 0], chestR: [0, 0, 0], headR: [0, 0, 0], armL: {}, armR: {}, legL: {}, legR: {}, eye: {} });
  const TPOSE = { hip: [0, 0, 0], hipR: [0, 0, 0], chestR: [0, 0, 0], headR: [0, 0, 0], armL: { rel: [0.53, 0, 0], palm: [0, -1, 0], curl: 0 }, armR: { rel: [-0.53, 0, 0], palm: [0, -1, 0], curl: 0 }, legL: { l: [0.14, ANKLE, 0] }, legR: { l: [-0.14, ANKLE, 0] }, eye: { wide: 0, ext: 0 } };
  const cores = (ph, ps) => { he.core(ph); she.core(ps); };

  function walk(p, ph, st) {
    const c2 = Math.cos(ph * 2 * PI), s2 = Math.sin(ph * 2 * PI);
    for (const [key, s, o] of [['legL', 1, 0], ['legR', -1, 0.5]]) {
      const c = ((ph + o) % 1 + 1) % 1; let z, y = 0, pitch = 0;
      if (c < 0.5) { z = st * (0.5 - c * 2); pitch = -0.25 * sm(0.15, 0, c) + 0.35 * sm(0.35, 0.5, c); }
      else { const u = (c - 0.5) * 2; z = st * (-0.5 + sm(0, 1, u)); y = Math.sin(PI * u) * 0.12; pitch = 0.5 * (1 - u) - 0.25 * u; }
      p[key] = { l: [s * 0.085, ANKLE + y, z], pitch, yaw: s * 0.05 };
    }
    p.hip = [0, -0.04 + 0.022 * Math.cos(ph * 4 * PI), 0];
    p.hipR = [0.03, -0.14 * c2, 0.04 * s2]; p.chestR = [0.03, 0.3 * c2, -0.03 * s2];
    p.armL = { rel: [0.07, -0.51, 0.04 - 0.2 * c2] }; p.armR = { rel: [-0.07, -0.51, 0.04 + 0.2 * c2] };
    p.skirt = [0, 0, 1.03 + 0.04 * Math.abs(c2)];
  }
  const plant = (p, w = 0.13) => { p.legL = { l: [w, ANKLE, 0] }; p.legR = { l: [-w, ANKLE, 0] }; };

  // the pair standing close: he at −dir, she at +dir, facing each other
  function pair(cx, cz, ang, d) {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const ph = P(cx - dx * d / 2, cz - dz * d / 2, Math.atan2(dx, dz)), ps = P(cx + dx * d / 2, cz + dz * d / 2, Math.atan2(-dx, -dz));
    plant(ph); plant(ps, 0.11);
    return { ph, ps, dx, dz };
  }
  // kiss / embrace: o = { gap, contact:[y,z] (head-local point that should meet), lean, kiss, hold, sway, hePitch, shePitch, roll }
  function closePair(S, cx, cz, ang, o) {
    const q = pair(cx, cz, ang, 0.8), { ph, ps } = q, sw = o.sway || 0, k = o.kiss, br = 0.012 * Math.sin(S.t * 1.7);
    ph.hip = [sw * 0.035, -0.015, 0.02 * o.lean]; ps.hip = [-sw * 0.035, 0, 0.02 * o.lean];
    ph.hipR = [0.04 * o.lean, 0, sw * 0.03]; ps.hipR = [0.03 * o.lean, 0, -sw * 0.03];
    ph.chestR = [0.13 * o.lean + br, 0, sw * 0.04]; ps.chestR = [0.07 * o.lean - br, 0, -sw * 0.04];
    ph.headR = [o.hePitch, o.yaw || 0, o.roll]; ps.headR = [o.shePitch, o.yaw || 0, o.roll];
    ps.skirt = [0, sw * 0.05, 1];
    // slide the two together until the contact points are `gap` apart, and nod his head until they are level
    const [cy, cl] = o.contact || [0.2, 0.285], a = V3(), b = V3(), m = o.match ?? 1;
    for (let i = 0; i < 4; i++) {
      cores(ph, ps); he.wp('head', 0, cy, cl, a); she.wp('head', 0, cy, cl, b);
      const sh = ((b.x - a.x) * q.dx + (b.z - a.z) * q.dz - o.gap) / 2;
      ph.pos[0] += q.dx * sh; ph.pos[2] += q.dz * sh; ps.pos[0] -= q.dx * sh; ps.pos[2] -= q.dz * sh;
      ph.headR[0] += clamp((a.y - b.y) / 0.3, -0.3, 0.3) * 0.8 * m;
    }
    cores(ph, ps); he.wp('head', 0, cy, cl, a); she.wp('head', 0, cy, cl, b);
    const lf = V3(q.dz, 0, -q.dx), dir = V3(q.dx, 0, q.dz);   // his left, and his forward, in world
    const low = s => V3(cx + lf.x * 0.15 * s, gy(cz) + 0.9, cz + lf.z * 0.15 * s);
    const h = sm(0, 1, o.hold);
    ph.armR = { w: low(-1).lerp(she.wp('chest', 0.05, 0.16, -0.13), h), pole: [-0.8, -0.5, -0.2], curl: 0.35 };
    ph.armL = { w: low(1).lerp(she.wp('hips', -0.1, 0.12, -0.11), h), pole: [0.8, -0.5, -0.2], curl: 0.35 };
    ps.armL = { w: low(-1).add(V3(0, -0.03, 0)).lerp(he.wp('chest', -0.15, 0.4, 0.02), h), pole: [0.7, -0.7, 0], curl: 0.3 };
    ps.armR = { w: low(1).add(V3(0, -0.03, 0)).lerp(o.herHand === 'chest' ? he.wp('chest', 0.08, 0.26, 0.12) : he.wp('chest', 0.15, 0.4, 0.02), h), pole: [-0.7, -0.7, 0], curl: 0.3 };
    // eyes: each pair of eyeballs meets above the contact point, stalks crossed and wound around each other
    const M = a.clone().lerp(b, 0.5); M.y += o.eyeUp ?? 0.27;
    const E = (side, fwd) => M.clone().addScaledVector(lf, 0.075 * side).addScaledVector(dir, 0.055 * fwd);
    const wob = S.t * 1.3;
    ph.eye = { twine: k, phase: wob, gaze: [o.gazeY || 0, -0.35 * k + (o.gazeP || 0)], pupil: 1 + 0.35 * k, ext: o.ext || 0, L: { w: E(1, 1) }, R: { w: E(-1, 1) } };
    ps.eye = { twine: k, phase: wob + 1.2, gaze: [o.gazeY || 0, -0.1 * k + (o.gazeP || 0)], pupil: 1 + 0.35 * k, ext: o.ext || 0, L: { w: E(-1, -1) }, R: { w: E(1, -1) } };
    return q;
  }

  // ───────────── frame state ─────────────
  let R;
  const setCam = (pos, tgt, fov, roll = 0) => { R.cam = { pos, tgt, fov, roll }; };
  const chorusAt = t => { for (const dt of [0.3, 1.2, 2.2, 3.1]) { const v = voiceAt(t + dt); if (v.line && /chorus/i.test(v.line.sec)) return true; } return false; };

  // scheduled glitch events: at most one per 1.1 s slot, hashed from song time and the shot seed
  function events(S, rate) {
    const SL = 1.1, s = Math.floor(S.t / SL), sd = S.seed * 7.31;
    if (hash(s, sd) >= rate * S.gl) return null;
    const dur = 0.1 + 0.3 * hash(s, sd + 2), st = s * SL + hash(s, sd + 3) * (SL - dur);
    if (S.t < st || S.t >= st + dur) return null;
    return { type: Math.floor(hash(s, sd + 4) * 5), r: hash(s, sd + 5), r2: hash(s, sd + 6), k: (S.t - st) / dur };
  }
  function applyEvent(S, e, amt = 1) {
    if (!e) return;
    const G = R.g, fr = Math.round(S.t * 30);
    if (e.type === 0) { G.tear = 0.35 * amt; G.rgb = 0.004; }
    else if (e.type === 1) { G.patch = { kind: e.r < 0.6 ? 0 : 1, az: (e.r2 - 0.5) * 0.9, el: 0.22 + e.r * 0.3, w: 0.14 + 0.2 * e.r2, h: 0.08 + 0.12 * e.r }; }
    else if (e.type === 2) { G.pop = { i: Math.floor(e.r * 10), r: e.r2 }; G.tear = 0.08 * amt; }
    else if (e.type === 3) { G.sunJ = [(hash(fr, 1) - 0.5) * 0.16, (hash(fr, 2) - 0.5) * 0.05]; G.block = 0.06 * amt; }
    else { G.zf = { r: e.r, r2: e.r2 }; G.patch = e.r > 0.5 ? { kind: 1, az: (e.r2 - 0.5) * 1.2, el: 0.3, w: 0.1, h: 0.07 } : null; }
  }

  // ───────────── modes ─────────────
  const MODES = {
    beach(S) {
      R.look = 'day';
      const D = Math.min(S.dur, 12), st = 0.5, v = st / BEAT, x = 1.8 + v * (D * 0.5 - S.lt), ph2 = S.bp / 2;
      const ph = P(x, 0.45, -PI / 2), ps = P(x + 0.12, 1.05, -PI / 2);
      walk(ph, ph2, st); walk(ps, ph2 + 0.5, st / 0.93);
      ph.headR = [0.05, 0.45 + 0.2 * Math.sin(S.lt * 0.9), 0]; ps.headR = [-0.1, -0.5 + 0.2 * Math.sin(S.lt * 0.9 + 1), 0.06];
      ph.eye = { gaze: [0.3, -0.1] }; ps.eye = { gaze: [-0.3, 0.15] };
      cores(ph, ps);
      const hand = V3(x + 0.08 + 0.05 * Math.sin(ph2 * 2 * PI), gy(0.75) + 0.86 + 0.02 * Math.cos(ph2 * 4 * PI), 0.76);
      ph.armL = { w: hand, curl: 0.6 }; ps.armR = { w: hand.clone().add(V3(0.02, -0.02, 0.03)), curl: 0.6 };
      const u = S.lt / D;
      setCam(V3(-2.5 + 1.0 * u, 1.45 + 0.4 * u, 8.5 - 0.8 * u), V3(x * 0.45 + 0.6, 1.55, 0), 34);
      applyEvent(S, events(S, 0.6));
      // guaranteed: a patch of sky drops out early in the shot
      if (S.lt > 1.6 && S.lt < 2.25) R.g.patch = { kind: 0, az: 0.28, el: 0.3, w: 0.22, h: 0.13 };
      if (S.lt > 4.4 && S.lt < 4.62) { R.g.pop = { i: 4, r: 0.3 }; R.g.tear = 0.12 * S.gl; }
    },

    shirt(S) {
      R.look = 'day';
      const u = S.p, grab = sm(0.06, 0.18, u), lift = sm(0.2, 0.42, u), snag = sm(0.4, 0.45, u) * (1 - sm(0.64, 0.68, u)), pop = sm(0.64, 0.7, u), down = sm(0.76, 0.95, u);
      const tug = snag * Math.sin((u - 0.42) * S.dur * 7.5);
      const ph = P(2.0, 2.3, 0.3), ps = P(3.15, 2.6, -1.0);
      plant(ph, 0.15); plant(ps, 0.1);
      ph.hip = [0.05 * tug, -0.02 - 0.03 * snag, 0]; ph.hipR = [0, 0, 0.06 * tug];
      ph.chestR = [-0.12 * lift * (1 - down) + 0.1 * snag, 0.1 * tug, 0.1 * tug]; ph.headR = [0.2 * snag - 0.1 * pop * (1 - down), 0.35 * down, 0.12 * tug];
      const wide = sm(0.6, 0.72, u);
      ps.hip = [0, 0, -0.03 * wide]; ps.chestR = [-0.08 * wide, 0, 0]; ps.headR = [-0.05 - 0.1 * wide, -0.25, 0.1 * (1 - wide)];
      ps.eye = { wide, ext: 0.7 * wide, gaze: [-0.15, 0.1 - 0.35 * wide], pupil: 1 + 0.3 * wide };
      ph.eye = { wide: 0.6 * snag, ext: 0.5 * snag, gaze: [0.5 * down, 0.3 * snag] };
      ps.skirt = [0, 0, 1 + 0.03 * Math.sin(S.t * 2)];
      cores(ph, ps);
      // hem and top of the shirt tube in his root frame
      const hem0 = 1.06, hem = mix(mix(hem0, 1.66, lift) + 0.05 * tug, 2.13, pop), topY = Math.max(1.52, hem + mix(0.3, 0.2, pop));
      const rx = mix(0.215, 0.25, lift), rz = mix(0.15, 0.3, lift);
      he.shirtOn = u < 0.2;
      const held = 1 - down;
      if (!he.shirtOn) {
        cloth.visible = true;
        const hc = he.wp('root', 0.02 * tug, (hem + topY) / 2, 0.03 * lift), bund = sm(0.7, 0.8, u);
        const hand = he.wp('root', -0.36, 1.0, 0.06);
        const drop = sm(0.9, 1.0, u), pos = hc.lerp(hand, bund * down); pos.y = mix(pos.y, gy(2.3) + 0.08, drop); pos.x -= 0.25 * drop;
        cloth.position.copy(pos); cloth.rotation.set(0.1 * tug + 1.2 * bund * down, ph.yaw, 0.15 * tug + 0.5 * drop);
        const sh = mix(1, 0.55, bund);
        cloth.scale.set(rx * sh, Math.max(0.12, (topY - hem)) * mix(1, 0.7, bund), rz * mix(sh, 0.45, bund));
        clothCap.visible = bund > 0.5; clothCap.position.copy(pos); clothCap.scale.set(0.16, 0.1, 0.13); clothCap.rotation.copy(cloth.rotation);
      }
      const hy = mix(0.9, hem, grab) , hxw = mix(0.2, rx + 0.02, grab);
      ph.armL = { l: mix3([hxw, hy, 0.1], [0.2, 1.02, 0.02], down), pole: [1, 0.1, -0.6], curl: mix(0.9, 0.3, down), palm: [-1, 0, 0] };
      ph.armR = { l: mix3([-hxw, hy, 0.1], [-0.36, 1.0, 0.06], down), pole: [-1, 0.1, -0.6], curl: 0.9, palm: [1, 0, 0] };
      const toChest = sm(0.28, 0.42, u);
      ps.armR = { w: she.wp('chest', 0.0, mix(-0.2, 0.27, toChest), mix(0.05, 0.14, toChest)).add(V3(0, 0, 0)), pole: [-1, -0.6, 0.1], curl: 0.25, palm: [0, 0, -1], dir: toChest > 0.5 ? [0.5, 0.6, 0] : undefined };
      ps.armL = { rel: [0.06, -0.5, 0.02 + 0.06 * wide] };
      setCam(V3(2.3 + 0.3 * u, 1.5, 7.8 - 1.2 * u), V3(2.55, 1.36, 2.4), 30);
      applyEvent(S, events(S, 0.3));
      if (u > 0.66 && u < 0.66 + 0.2 / S.dur) { R.g.tear = 0.3 * S.gl; R.g.rgb = 0.005 * S.gl; }
    },

    dance(S) {
      R.look = 'dusk';
      const cx = -6.5, cz = 1.7, ang = 0.5;
      const k = Math.floor(S.bp), bph = S.bp - k, hit = Math.exp(-bph * 4.5), sw = i => (i % 2 ? 1 : -1);
      const side = mix(sw(k), sw(k + 1), sm(0.5, 1, bph));
      const phr = Math.floor(k / 8), tPhr = BEAT0 + phr * 8 * BEAT;
      const moveOf = i => (chorusAt(BEAT0 + i * 8 * BEAT) ? [1, 2, 1, 3] : [0, 2, 0, 3])[((i + S.seed) % 4 + 4) % 4];
      const m = moveOf(phr), mPrev = moveOf(phr - 1), into = sm(0, 1, (S.bp - phr * 8) / 1.0);
      const dOf = mv => (mv === 2 ? 0.5 : 0.8), d = mix(dOf(mPrev), dOf(m), into);
      const q = pair(cx, cz, ang, d), { ph, ps } = q;
      const bob = -0.03 - 0.11 * hit;
      const solo = (p, sd, mv, isHe) => {
        const s1 = sd;
        if (mv === 0) {
          p.hip = [0.09 * s1, bob, 0]; p.hipR = [0, 0.2 * s1, 0.1 * s1]; p.chestR = [0.06, -0.35 * s1, -0.08 * s1]; p.headR = [0.05 * hit, 0.15 * s1, 0.08 * s1];
          for (const [key, s] of [['armL', 1], ['armR', -1]]) { const up = sm(-0.4, 0.6, s * s1); p[key] = { rel: mix3([s * 0.2, -0.2, 0.24], [s * 0.14, 0.5 + 0.05 * hit, 0.1], up), pole: [s, -0.3, -0.6], curl: 0.9, palm: [0, 0, 1] }; }
        } else if (mv === 1) {
          p.hip = [0.1 * s1, bob, 0]; p.hipR = [0, 0, 0.15 * s1]; p.chestR = [-0.06, 0, -0.14 * s1]; p.headR = [-0.1, 0, -0.1 * s1];
          for (const [key, s] of [['armL', 1], ['armR', -1]]) p[key] = { rel: [s * 0.2 + 0.16 * s1, 0.47 + 0.07 * hit, 0.04], pole: [s, -0.2, -0.5], curl: 0.1, palm: [0, 0, 1] };
        } else if (mv === 3) {
          if (isHe) { p.hip = [0.05 * s1, bob, 0]; p.chestR = [-0.05, 0, 0.05 * s1]; for (const [key, s] of [['armL', 1], ['armR', -1]]) p[key] = { rel: [s * (-0.17 + 0.3 * (1 - hit)), 0.42, 0.2], pole: [s, -0.4, -0.3], curl: 0.05, palm: [-s, 0, 0] }; }
          else { p.yaw += 2 * PI * sm(0, 1, ((S.bp - phr * 8) % 4) / 3.4); p.hip = [0, bob * 0.6, 0]; p.chestR = [-0.08, 0, 0]; for (const [key, s] of [['armL', 1], ['armR', -1]]) p[key] = { rel: [s * 0.22, 0.48, 0.02], pole: [s, -0.2, -0.5], curl: 0.2, palm: [0, 0, 1] }; p.skirt = [0, 0, 1.3]; }
        } else { p.hip = [0.07 * s1, bob * 0.8, 0.03]; p.hipR = [0, 0, 0.16 * s1]; p.chestR = [0.08, 0, -0.1 * s1]; p.headR = [isHe ? 0.2 : -0.15, 0, 0.12 * s1]; }
        const lift = 0.05 * (1 - hit);
        p.legL.l[1] += lift * clamp(-s1); p.legR.l[1] += lift * clamp(s1);
        if (!isHe && !p.skirt) p.skirt = [0, 0.06 * s1, 1.04 + 0.12 * hit];
      };
      solo(ph, side, m, true); solo(ps, -side, m, false);
      ph.eye = { gaze: [0, -0.15], wide: 0.15 * hit }; ps.eye = { gaze: [0, 0.2], wide: 0.15 * hit };
      cores(ph, ps);
      if (m === 2) {
        ph.armL = { w: she.wp('hips', -0.17, 0.1, 0.0), pole: [0.8, -0.6, 0], curl: 0.4 }; ph.armR = { w: she.wp('hips', 0.17, 0.1, 0.0), pole: [-0.8, -0.6, 0], curl: 0.4 };
        ps.armL = { w: he.wp('chest', -0.17, 0.42, 0.0), pole: [0.8, -0.6, 0], curl: 0.3 }; ps.armR = { w: he.wp('chest', 0.17, 0.42, 0.0), pole: [-0.8, -0.6, 0], curl: 0.3 };
      }
      R.fire = { at: [cx + 2.3, cz + 0.9], k: 0.85 };
      const mid = 1.2, zoom = 1 - 0.02 * hit;
      if (S.cam === 1) {         // close on her, over his shoulder side
        const a = ang + PI - 1.05 + 0.15 * Math.sin(S.lt * 0.5), hx = cx + q.dx * 0.4, hz = cz + q.dz * 0.4;
        setCam(V3(hx + Math.cos(a) * 2.7, 1.4 + 0.1 * Math.sin(S.lt * 0.7), hz + Math.sin(a) * 2.7), V3(hx, 1.3, hz), 31 * zoom);
      } else if (S.cam === 2) {  // orbit, on him
        const a = ang + 0.9 + S.lt * 0.3;
        setCam(V3(cx + Math.cos(a) * 3.3, 1.35, cz + Math.sin(a) * 3.3), V3(ph.pos[0] * 0.8 + cx * 0.2, 1.35, ph.pos[2] * 0.8 + cz * 0.2), 32 * zoom);
      } else {
        const a = 1.25 + 0.2 * Math.sin(S.lt * 0.25 + S.seed);
        setCam(V3(cx + 0.8 + Math.cos(a) * 5.6, 1.1 + 0.03 * S.lt, cz + Math.sin(a) * 5.6), V3(cx + 0.7, mid, cz), 33 * zoom);
      }
      applyEvent(S, events(S, 0.45));
    },

    sunrise(S) {
      R.look = 'sunrise';
      const on = S.p >= 0.6, stut = S.p > 0.56 && !on, fr = Math.round(S.t * 15), after = on ? (S.p - 0.6) * S.dur : 0;
      R.sunEl = mix(-1.5, 5.5, clamp(S.p / 0.6)) + (stut ? (hash(fr, 3) - 0.5) * 4 : 0);
      if (stut) { R.g.sunJ = [(hash(fr, 4) - 0.5) * 0.12, 0]; R.g.tear = 0.12 * S.gl; R.rect = hash(fr, 5) < 0.4 ? 1 : 0; R.lights = hash(fr, 6) < 0.3 ? 1 : 0; }
      if (on) { R.rect = 1; R.lights = 1; R.sunEl = 9; R.flick = after < 0.5 ? (hash(Math.round(S.t * 30), 7) < 0.35 ? 0.5 : 0) : 0; }
      const cx = -8.5, look = sm(0.1, 0.9, after); R.sunAz = 0.03;
      const mk = (x, s, isHe) => {
        const p = P(x, 3.2, PI);
        p.hip = [0, -0.83, 0]; p.hipR = [-0.72 + 0.12 * look, 0, 0]; p.chestR = [0.18, s * 0.12 * look, 0];
        p.headR = [0.42 - 0.75 * look + 0.03 * Math.sin(S.t * 0.8 + x), s * (0.25 + 0.2 * Math.sin(S.lt * 0.5)) * (1 - look), 0];
        p.legL = { l: [0.14, 0.09, isHe ? 0.6 : 0.86], pole: [0, 1, 0.2], pitch: -0.9 }; p.legR = { l: [-0.14, 0.09, 0.86], pole: [0, 1, 0.2], pitch: -0.9 };
        p.armL = { l: [0.34, 0.03, -0.42], pole: [0.3, 0, -1], palm: [0, -1, 0], dir: [0.3, 0, -1], curl: 0.1 }; p.armR = { l: [-0.34, 0.03, -0.42], pole: [-0.3, 0, -1], palm: [0, -1, 0], dir: [-0.3, 0, -1], curl: 0.1 };
        p.eye = { ext: 0.5, wide: 0.9 * sm(0, 0.15, after), gaze: [0, 0.1 + 0.5 * look] }; p.skirt = [-0.75, 0, 1];
        return p;
      };
      const ph = mk(cx - 0.4, 1, true), ps = mk(cx + 0.36, -1, false);
      cores(ph, ps);
      // inner hands meet on the sand between them (he faces −z, so his left is world −x … his RIGHT is towards her)
      const hand = V3(cx - 0.02, gy(3.3) + 0.06, 3.32);
      ph.armR = { w: hand, pole: [-0.3, 0.5, -1], palm: [0, -1, 0], curl: 0.4 }; ps.armL = { w: hand.clone().add(V3(0.03, 0.03, 0)), pole: [0.3, 0.5, -1], palm: [0, -1, 0], curl: 0.4 };
      setCam(V3(cx + 1.9 - 0.4 * S.p, 1.45 + 0.2 * S.p, 6.6 - 0.6 * S.p), V3(cx - 0.25, 0.3 + 0.15 * look, 0), 36);
      if (!on) applyEvent(S, events(S, 0.25));
    },

    sunset(S) {
      R.look = 'sunset';
      const cx = 9, cz = 0.5, k = sm(0.3, 0.62, S.p);
      closePair(S, cx, cz, 0, { gap: mix(0.42, -0.03, k), match: k, lean: k, kiss: k, hold: sm(0.35, 0.75, S.p), sway: 0.3 * Math.sin(S.t * 0.6), hePitch: 0.2 * k, shePitch: -0.3 * k, roll: 0.3 * k, herHand: 'chest' });
      R.sunEl = 3.9 - 1.5 * S.p;
      setCam(V3(cx + 0.5 - 0.5 * S.p, 0.95, mix(9.2, 6.2, sm(0, 1, S.p))), V3(cx, 1.28, 0), 30);
      R.sunAz = Math.atan2(cx - R.cam.pos.x, R.cam.pos.z - cz);
      applyEvent(S, events(S, 0.14));
    },

    wipe(S) {
      R.look = 'day';
      const cx = -4.2, cz = 1.6, u = S.p, w = sm(0.08, 0.9, u), turn = sm(0.1, 0.4, u);
      const ph = P(cx - 0.36, cz, 0.12), ps = P(cx + 0.36, cz, -0.12);
      plant(ph); plant(ps, 0.1);
      ph.headR = [-0.1 * turn, -0.75 * turn, 0]; ps.headR = [-0.12 * turn, -0.8 * turn, 0.05];
      ph.chestR = [0, -0.2 * turn, 0]; ps.chestR = [-0.05 * turn, -0.2 * turn, 0];
      ph.armL = { rel: [0.14, -0.5, 0.03], curl: 0.6 }; ph.armR = { rel: [-0.05, -0.53, 0.05] };
      ps.armR = { rel: [-0.19, -0.48, 0.03], curl: 0.6 }; ps.armL = { rel: [0.1 + 0.1 * turn, mix(-0.5, 0.2, turn), 0.2 * turn], pole: [1, -0.5, -0.3] };
      const wd = sm(0.2, 0.5, u);
      ph.eye = { wide: 0.7 * wd, ext: 0.4 * wd, gaze: [-0.3 * turn, 0.1] }; ps.eye = { wide: wd, ext: 0.6 * wd, gaze: [-0.3 * turn, 0.1] };
      cores(ph, ps);
      setCam(V3(cx + 2.4 - 0.5 * u, 1.5, 7.2 - 1.2 * u), V3(cx - 0.5 + 0.3 * u, 1.45, 0), 34);
      R.wipe = w; R.void = true;
      // on the void side the figures settle into T-poses; the wipe reaches them around w ≈ 0.5
      const tk = sm(0.5, 0.8, w);
      R.voidPose = [lerpPose(ph, { ...TPOSE, pos: ph.pos, yaw: 0 }, tk), lerpPose(ps, { ...TPOSE, pos: ps.pos, yaw: 0 }, tk)];
      if (u < 0.85) applyEvent(S, events(S, 0.5));
      R.g.rgb = Math.max(R.g.rgb, 0.0025);
    },

    hands(S) {
      R.look = 'morning'; R.room = true;
      const o = W.room.position, u = S.p, reach = sm(0.4, 0.72, u), settle = sm(0.68, 0.95, u);
      // camera = his eyes; his shoulder sits just below and right of the lens and leans in as he reaches
      const eye = V3(o.x + 0.2 + 0.01 * Math.sin(S.t * 0.7), o.y + 1.66 + 0.008 * Math.sin(S.t * 1.1), o.z + 1.1 - 0.12 * reach);
      const ph = P(eye.x, eye.z + 0.08 - 0.5 * reach, PI, eye.y - 0.27 - 1.48), ps = P(o.x + 0.02 * Math.sin(S.t * 0.5), o.z - 0.2, 0, o.y);
      plant(ph); plant(ps, 0.1);
      ps.hip = [0.02 * Math.sin(S.t * 0.6), 0, 0]; ps.chestR = [0.02 * Math.sin(S.t * 0.9), 0, 0];
      ps.headR = [-0.1, -0.1 * settle, -0.22 * settle];     // leans her head into his palm
      ps.eye = { gaze: [0.05, 0.12], pupil: 1 + 0.5 * settle, ext: 0.1 * reach, wide: 0.1 * (1 - settle) };
      ps.armL = { rel: [0.05, -0.52, 0.05] }; ps.armR = { rel: [-0.05, -0.52, 0.05] };
      cores(ph, ps);
      he.fp = true; he.fpArm = -1;
      const her = she.brainW();
      const lookA = V3(eye.x + 0.1, eye.y - 0.36, eye.z - 0.42), lookB = V3(her.x + 0.1, her.y + 0.06, her.z);
      const tgt = lookA.clone().lerp(lookB, sm(0.34, 0.66, u));
      setCam(eye, tgt, mix(42, 38, reach));
      // the hand: first held up and flexed, then it reaches for the side of her brain
      const flexP = V3(eye.x + 0.1, eye.y - 0.33 + 0.015 * Math.sin(S.lt * 1.3), eye.z - 0.42);
      const cheek = she.wp('head', 0.215, 0.08, 0.17);
      const wr = flexP.clone().lerp(cheek, reach); wr.y += 0.06 * Math.sin(PI * reach);
      const turnA = 0.5 - 0.5 * Math.cos(S.lt * 1.15), a = mix(0.25, 2.6, sm(0.25, 0.75, turnA)) * (1 - reach);
      const dirW = V3(-0.12, 1, -0.1).normalize().lerp(V3(-0.25, 0.85, -0.45).normalize(), reach), palmW = V3(Math.sin(a), 0, Math.cos(a)).lerp(V3(-1, 0.1, -0.35), reach);
      const curl = [0, 1, 2, 3, 4].map(i => mix(0.08 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(S.lt * 3.1 - i * 0.55), 2), 0.22 + 0.1 * settle + 0.03 * Math.sin(S.t * 1.5 + i), reach));
      const dl = he.dirLocal(dirW), pl = he.dirLocal(palmW);
      ph.armR = { w: wr, pole: [-0.6, -1, 0.2], dir: [dl.x, dl.y, dl.z], palm: [pl.x, pl.y, pl.z], curl };
      R.shadowY = o.y;
    },

    embrace(S) {
      R.look = 'golden';
      const cx = 5, cz = 2.2, ang = 0.2;
      closePair(S, cx, cz, ang, { gap: -0.24, match: 0, yaw: -0.55, lean: 0.5, kiss: 0, hold: 1, sway: Math.sin(S.t * 0.8), hePitch: 0.3, shePitch: -0.08, roll: 0.12, ext: 0.1, gazeP: -0.1, gazeY: 0.6 });
      const a = 1.35 + 0.35 * (S.p - 0.5) + ang;
      setCam(V3(cx + Math.cos(a) * 3.3, 1.5, cz + Math.sin(a) * 3.3), V3(cx, 1.42, cz), 30 - 3 * S.p);
      // one short tear in the fabric near the end
      const g0 = 0.9 * S.dur, gt = S.lt - g0;
      if (S.p > 0.85 && gt >= 0 && gt < 0.14 && S.gl > 0) {
        R.g.tear = 0.5; R.g.rgb = 0.008; R.void = true; R.g.vblock = gt < 0.07 ? 0.55 : 0.25; R.g.patch = { kind: 0, az: 0.5, el: 0.25, w: 0.5, h: 0.2 };
        R.voidPose = null;
      }
    },

    kiss(S) {
      R.look = 'night';
      const cx = 4, cz = 1.6, e = clamp(S.energy * 1.6);
      closePair(S, cx, cz, 0.3, { gap: -0.03, lean: 1, kiss: 1, hold: 1, sway: 0.6 * Math.sin(S.bp * PI / 2), hePitch: 0.2, shePitch: -0.3, roll: 0.3 + 0.05 * Math.sin(S.t * 0.9) });
      R.fire = { at: [cx - 2.6, cz + 0.4], k: 1 }; R.fw = 1;
      const a = 1.2 + S.lt * 0.42 + S.seed, r = 2.9 - 0.4 * Math.sin(S.lt * 0.3);
      setCam(V3(cx + Math.cos(a) * r, 1.45 + 0.25 * Math.sin(S.lt * 0.37), cz + Math.sin(a) * r), V3(cx, 1.58, cz), 31 * (1 - 0.025 * S.beat.pulse));
      applyEvent(S, events(S, 0.25 + 0.6 * e), 0.6 + e);
      if (S.onset > 1.15 && e > 0.5) { R.g.tear = Math.max(R.g.tear, 0.18 * S.gl); R.g.rgb = 0.004; }
    },
  };

  const tmpC = new THREE.Color(), tmpC2 = new THREE.Color(), sunDir = new THREE.Vector3();
  let lastOK = true;

  function update(t, shot) {
    const off = shot.off || 0, lt = shot.lt - off, dur = shot.span || shot.dur || 8;
    const S = { t, lt, dur, p: clamp(lt / dur), beat: shot.beat, bp: (t - BEAT0) / BEAT, energy: shot.energy || 0, onset: shot.onset || 0, seed: shot.seed || 1, gl: shot.glitch ?? 1, cam: shot.cam | 0 };
    R = { look: 'day', g: { tear: 0, block: 0, rgb: 0, vblock: 0, patch: null, pop: null, sunJ: null, zf: null }, wipe: -1, void: false, voidPose: null, fire: null, fw: 0, room: false, rect: 0, lights: 0, flick: 0, shadowY: null };
    he.fp = false; he.shirtOn = true; cloth.visible = false; clothCap.visible = false;
    (MODES[shot.mode] || MODES.beach)(S);
    he.limbs(R.ph || lastPose[0]); she.limbs(R.ps || lastPose[1]);

    // look
    if (shot.look && LOOKS[shot.look]) R.look = shot.look;
    const L = LOOKS[R.look], sk = W.skyU, g = R.g;
    sk.top.value.set(L.top); sk.hor.value.set(L.hor); sk.sunCol.value.set(L.sunCol); sk.sunCol2.value.set(L.sunCol2);
    const el = (R.sunEl ?? L.el) * PI / 180 + (g.sunJ ? g.sunJ[1] : 0), az = (R.sunAz ?? L.az * PI / 180) + (g.sunJ ? g.sunJ[0] : 0);
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    sk.sunDir.value.copy(sunDir); sk.sunR.value = L.R; sk.glow.value = L.glow; sk.band.value = L.band; sk.gexp.value = L.gexp || 0.45; sk.stars.value = L.stars || 0; W.seaU.calm.value = R.room ? 0.15 : 1; sk.rect.value = R.rect; sk.lights.value = R.lights;
    sk.patchOn.value = g.patch ? 1 : 0;
    if (g.patch) { const c = R.cam, base = Math.atan2(c.tgt.x - c.pos.x, -(c.tgt.z - c.pos.z)); sk.pRect.value.set(base + g.patch.az, g.patch.el, g.patch.w, g.patch.h); sk.patchKind.value = g.patch.kind; sk.pseed.value = S.seed; }
    const lo = R.lights;
    W.sun.color.set(L.sunC).lerp(tmpC.set(0xe8ffe8), lo); W.sun.intensity = mix(L.sunI, 1.6, lo) * (1 - R.flick);
    const ld = lo ? tmpV.set(0.1, 1, 0.3).normalize() : sunDir;
    W.sun.position.copy(R.cam.tgt).addScaledVector(ld, 60); W.sun.target.position.copy(R.cam.tgt);
    W.hemi.color.set(L.hemiS).lerp(tmpC.set(0xdff5dc), lo); W.hemi.groundColor.set(L.hemiG).lerp(tmpC.set(0xb8c8b4), lo); W.hemi.intensity = mix(L.hemiI, 2.3, lo) * (1 - R.flick);
    W.seaU.deep.value.set(L.deep); W.seaU.shal.value.set(L.shal); W.seaU.sunCol.value.set(L.sunCol2).lerp(tmpC.set(L.sunCol), 0.5); W.seaU.sunPow.value = L.sunPow; W.seaU.sunAmt.value = L.sunAmt * (1 - lo); W.seaU.flatK.value = lo;
    W.sandMat.color.set(0xffffff).lerp(tmpC.set(0xa8b8a0), lo * 0.85);
    W.cloudM.emissive.set(L.cloud); W.cloudM.visible = !lo;
    // fire, fireworks, room
    const fk = R.fire ? R.fire.k : 0;
    W.animate(t, S.beat, R.fire ? R.fire.at : [0, 0], fk, R.fw, [R.cam.tgt.x, 0, R.cam.tgt.z]);
    W.fireL.intensity = fk * (13 + 2.5 * Math.sin(t * 11) + 1.5 * Math.sin(t * 23) + 8 * S.beat.pulse);
    if (R.fw) { W.hemi.intensity += 1.3 * Math.min(1.5, W.fwFlash); }
    W.rim.intensity = R.look === 'night' ? 1.3 : R.look === 'dusk' ? 0.8 : 0; W.rim.color.set(R.look === 'night' ? 0xff40c0 : 0xff6090);
    W.rim.position.copy(R.cam.tgt).add(tmpV.set(-6, 5, -8)); W.rim.target.position.copy(R.cam.tgt);
    W.room.visible = R.room; W.roomL.intensity = R.room ? 9 : 0;
    W.house.visible = !R.room; W.fw.visible = W.fw.visible && !R.room;
    he.shadow.visible = !he.fp; const sy = R.shadowY;
    he.shadow.position.y = (sy ?? gy(he.root.position.z)) + 0.015; she.shadow.position.y = (sy ?? gy(she.root.position.z)) + 0.015;
    he.shadow.material.opacity = she.shadow.material.opacity = R.look === 'night' || R.look === 'sunset' ? 0.5 : 0.3;

    // glitch props
    for (let i = 0; i < W.palms.length; i++) { const p = W.palms[i]; p.position.copy(p.userData.home); p.scale.setScalar(1); p.visible = true; }
    W.roof.position.y = 5.1; W.house.position.y = 0;
    if (g.pop) {
      const i = g.pop.i;
      if (i < 8) { const p = W.palms[i]; if (g.pop.r < 0.35) p.visible = false; else if (g.pop.r < 0.7) { p.position.y += 2.5; p.position.x += 3; } else p.scale.set(1, 2.4, 1); }
      else if (i === 8) W.roof.position.y = 7.2; else W.house.position.y = 1.8;
    }
    W.zfSand.visible = !!g.zf && !R.room; W.zfWall.visible = !!g.zf;
    if (g.zf) { W.zfSand.position.set(R.cam.tgt.x + (g.zf.r - 0.5) * 6, gy(R.cam.tgt.z + 2.2) + 0.03, R.cam.tgt.z + 2.2); W.zfSand.scale.set(2.5 + 3 * g.zf.r2, 1.2 + g.zf.r, 1); }

    // camera
    camera.position.copy(R.cam.pos); camera.up.set(Math.sin(R.cam.roll), Math.cos(R.cam.roll), 0); camera.lookAt(R.cam.tgt);
    camera.fov = R.cam.fov; camera.updateProjectionMatrix();
    W.sky.position.copy(camera.position); W.seaU.camPos.value.copy(camera.position);

    U.tear.value = g.tear * S.gl; U.block.value = g.block * S.gl; U.rgb.value = g.rgb; U.vblock.value = g.vblock; U.wipe.value = R.wipe; U.seed.value = Math.round(t * 30) % 977;
    frame = { S };
  }
  const tmpV = new THREE.Vector3();
  let frame = null; const lastPose = [null, null];
  // wrap cores so limbs() gets the same pose objects the mode built
  const core0 = cores;
  he._core = he.core; she._core = she.core;
  he.core = p => { R.ph = p; he._core(p); }; she.core = p => { R.ps = p; she._core(p); };

  function render(renderer, target) {
    const bg = scene.background;
    renderer.setRenderTarget(rtA); renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(scene, camera);
    if (R.void) {
      // second pass: the void. Grid floor, grey nothing, the figures as wireframes.
      const vis = [W.sky.visible, W.beach.visible, W.room.visible];
      W.sky.visible = W.beach.visible = W.room.visible = false; W.grid.visible = true; he.shadow.visible = she.shadow.visible = false;
      const cv = cloth.visible; cloth.visible = false;
      if (R.voidPose) { const a = R.ph, b = R.ps; he._core(R.voidPose[0]); she._core(R.voidPose[1]); he.limbs(R.voidPose[0]); she.limbs(R.voidPose[1]); R.ph = a; R.ps = b; }
      W.grid.position.y = gy(he.root.position.z) - 0.001;
      for (const m of figMats) m.wireframe = true;
      scene.overrideMaterial = null;
      const save = figMats.map(m => [m.color ? m.color.getHex() : 0, m.map, m.vertexColors]);
      renderer.setRenderTarget(rtB); renderer.setClearColor(W.voidBg, 1); renderer.clear();
      const li = [W.hemi.intensity, W.sun.intensity, W.fireL.intensity, W.rim.intensity];
      W.hemi.intensity = 0.25; W.sun.intensity = 0; W.fireL.intensity = 0; W.rim.intensity = 0;
      renderer.render(scene, camera);
      [W.hemi.intensity, W.sun.intensity, W.fireL.intensity, W.rim.intensity] = li;
      for (const m of figMats) m.wireframe = false;
      [W.sky.visible, W.beach.visible, W.room.visible] = vis; W.grid.visible = false; he.shadow.visible = she.shadow.visible = true; cloth.visible = cv;
    }
    renderer.setRenderTarget(target);
    renderer.render(qScene, qCam);
  }

  return { render, update };
}

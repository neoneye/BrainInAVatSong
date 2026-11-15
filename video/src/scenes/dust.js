// dust.js: the dusty glass of a long-abandoned specimen jar. An invisible finger writes in the dust and through the
// wiped strokes we see what is behind the glass (shot.backdrop, another scene rendered this frame).
// Port of assets/dust/index.html: the simulation (dust/core.js) runs on the CPU in 0.8 mm cells and is uploaded as one
// float texture; the shader below is the experiment's, relit for a dark lab (cold raking light, self-lit backdrop).
import * as THREE from 'three';
import { BEAT, BEAT0 } from '../audio.js';
import * as C from './dust/core.js';
import { glyph, heart, normalize, lineWidth, SPACE, GAP } from './dust/font.js';

export const meta = {
  modes: ['write', 'heart', 'wipe'],
  params: {
    text: 'message to write, lines separated by "\\n" (uppercased; "♥" or "<3" draws a heart)',
    drops: '0..1 (default 0.3): how many water drops run down on beats in the second half of the shot',
    seed: 'dust pattern, wobble of the hand, where the drops fall',
    behind: 'timeline: { scene, mode } rendered behind the glass (shot.backdrop); without it a built-in murky brain glow',
  },
};

const { W, H, NX, NY, N } = C;
const DT = 1 / 30;

// ---------------------------------------------------------------- the finger's path
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// polyline → points at most `step` mm apart
function resample(pts, step) {
  const out = [pts[0].slice()];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(dist(a, b) / step)); for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  return out;
}
// a slightly unsteady hand: smooth seeded drift along the stroke
function wobble(pts, amp, wave, seed) {
  let s = 0; const out = [];
  for (let i = 0; i < pts.length; i++) { if (i) s += dist(pts[i], pts[i - 1]); out.push([pts[i][0] + amp * (C.vn1(s / wave + seed) * 2 - 1), pts[i][1] + amp * (C.vn1(s / wave + seed + 57.3) * 2 - 1)]); }
  return out;
}
function mkStroke(pts, r, tool, seed, press = 0.9) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i], pts[i - 1]));
  return { pts, cum, len: cum[cum.length - 1], r, tool, press, seed, t0: 0, t1: 0 };
}
// lay the lines out inside a box (mm): as large as fits, the widest line spanning the box width
const PITCH = 1.5;
const unitFor = (lines, box) => Math.min((box.x1 - box.x0) / Math.max(...lines.map(lineWidth)), (box.y1 - box.y0) / (6 * (1 + (lines.length - 1) * PITCH)), box.maxCap / 6);
// break the widest line at the space nearest its middle for as long as that makes the letters bigger
function wrap(lines, box) {
  for (;;) {
    const ws = lines.map(lineWidth), i = ws.indexOf(Math.max(...ws)), L = lines[i], cands = [...L].map((c, k) => (c === ' ' ? k : -1)).filter(k => k > 0);
    if (!cands.length || lines.length >= 5) return lines;
    const k = cands.reduce((a, b) => (Math.abs(b - L.length / 2) < Math.abs(a - L.length / 2) ? b : a));
    const next = [...lines.slice(0, i), L.slice(0, k), L.slice(k + 1), ...lines.slice(i + 1)];
    if (unitFor(next, box) <= unitFor(lines, box) * 1.08) return lines;
    lines = next;
  }
}
function layoutText(lines, box, seed, strokes) {
  lines = wrap(lines, box);
  const rng = C.mulberry(seed * 31 + 7), widths = lines.map(lineWidth), n = lines.length, pitch = PITCH;
  const u = unitFor(lines, box), cap = 6 * u;
  const r = Math.max(2.4, Math.min(10.5, cap / 12.5)), yTop = (box.y0 + box.y1) / 2 - cap * (1 + (n - 1) * pitch) / 2;
  lines.forEach((line, li) => {
    let x = (box.x0 + box.x1) / 2 - widths[li] * u / 2 + (rng() - 0.5) * u; const y = yTop + li * cap * pitch, slope = (rng() - 0.5) * 0.035;
    for (const ch of line) {
      if (ch === ' ') { x += (SPACE - GAP) * u; continue; }
      const g = glyph(ch), sc = 1 + (rng() - 0.5) * 0.08, dy = (rng() - 0.5) * 0.06 * cap + slope * (x - box.x0), shear = 0.06 + (rng() - 0.5) * 0.08;
      for (const st of g.strokes) {
        let pts = st.map(([gx, gy]) => [x + (gx + (6 - gy) * shear - 3 * shear) * u, y + dy + (6 - (6 - gy) * sc) * u]);
        pts = wobble(resample(pts, 1.5), cap * 0.022, cap * 0.45, rng() * 100);
        strokes.push(mkStroke(pts, r, 'finger', 1 + rng() * 50));
      }
      x += (g.w + GAP) * u;
    }
  });
  return cap;
}
// give every stroke its time window inside [ta, tb]: time in proportion to the distance drawn, with a short lift between
function schedule(strokes, ta, tb, lift) {
  if (!strokes.length) return;
  const cost = [], gap = []; let sum = 0;
  strokes.forEach((s, i) => { cost.push(s.len + s.r * 1.5); sum += cost[i]; gap.push(i + 1 < strokes.length ? lift + 0.45 * dist(s.pts[s.pts.length - 1], strokes[i + 1].pts[0]) : 0); sum += gap[i]; });
  let t = ta; const k = (tb - ta) / sum;
  strokes.forEach((s, i) => { s.t0 = t; t += cost[i] * k; s.t1 = t; t += gap[i] * k; });
}
function buildPlan(mode, text, seed, dur) {
  const lines = normalize(text), strokes = [], rng = C.mulberry(seed * 53 + 3);
  const ta = Math.min(0.35, 0.05 * dur);
  if (mode === 'wipe') {
    // the flat of a hand scrubs a rough porthole: round and round from the middle outwards, pushing the dust to the rim
    const cx = W * 0.5 + (rng() - 0.5) * 20, cy = H * 0.43, r = 34, turns = 3.8, R = 146, pts = [], a0 = rng() * 6.28;
    for (let q = 0; q <= 150; q++) {
      const f = q / 150, a = a0 + f * turns * Math.PI * 2, rad = R * Math.pow(f, 0.85) * (1 + 0.13 * Math.sin(a * 2.3 + 1) + 0.08 * Math.sin(a * 5.1));
      pts.push([cx + Math.cos(a) * rad * 1.3, cy + Math.sin(a) * rad]);
    }
    strokes.push(mkStroke(wobble(resample(pts, 2.5), 4, 50, rng() * 100), r, 'palm', 1 + rng() * 50, 0.95));
    schedule(strokes, ta, 0.6 * dur, 0);
  } else if (mode === 'heart') {
    // one big heart round the centre of the frame; a message, if any, small underneath afterwards
    const has = lines.length > 0, s = has ? 7.4 : 9.2, cy = has ? H * 0.34 : H * 0.42;
    const hs = [mkStroke(wobble(resample(heart(W * 0.5, cy, s), 1.5), 2.4, 70, rng() * 100), has ? 9 : 11, 'finger', 4.2)];
    const ts = []; if (has) layoutText(lines, { x0: W * 0.16, x1: W * 0.84, y0: H * 0.635, y1: H * 0.775, maxCap: H * 0.14 }, seed, ts);
    const tb = 0.75 * dur, tm = has ? ta + (tb - ta) * 0.5 : tb;
    schedule(hs, ta, tm, 0); schedule(ts, tm + (has ? 0.04 * dur : 0), tb, 10);
    strokes.push(...hs, ...ts);
  } else {
    const L = lines.length ? lines : ['♥'];
    const cap = layoutText(L, { x0: W * 0.1, x1: W * 0.9, y0: H * 0.06, y1: H * 0.72, maxCap: H * 0.5 }, seed, strokes);
    schedule(strokes, ta, 0.75 * dur, cap * 0.3);
  }
  const tDone = strokes.length ? strokes[strokes.length - 1].t1 : 0;
  return { strokes, tDone, dropFrom: mode === 'wipe' ? 0.55 * dur : 0.5 * dur, dropTo: Math.max(dur, tDone) + 4, tSimEnd: Math.max(dur, tDone) + 12 };
}
// where the fingertip is at shot-local time lt: [x, y, r, strength]
function tipAt(plan, lt, out) {
  out[3] = 0;
  for (const S of plan.strokes) {
    if (lt < S.t0 - 0.12) break;
    if (lt > S.t1 + 0.12) continue;
    const f = Math.min(1, Math.max(0, (lt - S.t0) / Math.max(1e-6, S.t1 - S.t0))), target = S.len * f;
    let k = 0; while (k + 2 < S.pts.length && S.cum[k + 1] < target) k++;
    const a = S.pts[k], b = S.pts[Math.min(k + 1, S.pts.length - 1)], seg = S.cum[Math.min(k + 1, S.cum.length - 1)] - S.cum[k], q = seg > 0 ? Math.min(1, (target - S.cum[k]) / seg) : 0;
    out[0] = a[0] + (b[0] - a[0]) * q; out[1] = a[1] + (b[1] - a[1]) * q; out[2] = S.r * (0.75 + 0.35 * S.press);
    out[3] = Math.min(1, (lt - S.t0 + 0.12) / 0.12, (S.t1 + 0.12 - lt) / 0.12);
    if (lt <= S.t1) break;
  }
  return out;
}

// ---------------------------------------------------------------- shader
const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const FS = `
precision highp float; precision highp sampler2D;
uniform sampler2D uA, uBG; uniform vec2 uPane, uRes; uniform float uHasBG, uTime, uGrain, uSeed; uniform vec4 uTip; uniform vec3 uDust;
varying vec2 vUv;
float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
vec3 tone(vec3 c){ float l = dot(c, vec3(.2126, .7152, .0722)) + 1e-5, m = l * (1. + l / 4.) / (1. + l); return clamp(c * m / l, 0., 1.); }
// stand-in for the scene behind the glass: murky green fluid lit from below and a vague brain
vec3 fallback(vec2 uv){
  vec2 q = (uv - vec2(.5, .56 + .012 * sin(uTime * .7))) * vec2(16. / 9., 1.);
  vec3 c = vec3(.004, .012, .006) + vec3(.16, .42, .1) * exp(-dot(q - vec2(0., -.5), q - vec2(0., -.5)) * 2.6) + vec3(.05, .16, .06) * exp(-dot(q, q) * 3.);
  c *= .8 + .2 * vnoise(q * 3. + vec2(0., -uTime * .15));
  vec2 b = q * vec2(1., 1.28); float r = length(b) + .03 * vnoise(q * 9.);
  vec2 w = q * 7. + 2.5 * vec2(vnoise(q * 5. + 3.), vnoise(q * 5. + 9.));
  float folds = abs(sin(w.x * 2.2 + sin(w.y * 2.6) * 1.6)), fis = smoothstep(.0, .02, abs(q.x + .01 * sin(q.y * 30.)));
  vec3 br = vec3(.42, .3, .24) * (.35 + .65 * smoothstep(0., .5, folds)) * (.45 + .55 * fis) * (.55 + .6 * smoothstep(.1, -.3, q.y)) * (1.05 - r * 1.6);
  br += vec3(.1, .3, .08) * smoothstep(.1, .3, r) * .6;
  return mix(c, br, smoothstep(.275, .25, r));
}
vec3 behind(vec2 uv){ uv = clamp(uv, vec2(.001), vec2(.999)); return uHasBG > .5 ? texture(uBG, uv).rgb : fallback(uv); }
void main(){
  vec2 t = vec2(vUv.x, 1. - vUv.y), p = t * uPane;                    // mm on the glass, y down
  vec2 px = 1. / vec2(textureSize(uA, 0));
  vec4 A = texture(uA, t);                                            // loose dust, crust (optical depth), water height, wet trail
  vec4 Ax = texture(uA, t + vec2(px.x, 0)), Ax2 = texture(uA, t - vec2(px.x, 0)), Ay = texture(uA, t + vec2(0, px.y)), Ay2 = texture(uA, t - vec2(0, px.y));
  vec2 grad = vec2(Ax.x + Ax.y - Ax2.x - Ax2.y, Ay.x + Ay.y - Ay2.x - Ay2.y) / 1.6;     // relief of the dust (optical depth per mm)
  vec2 wg = vec2(Ax.z - Ax2.z, Ay.z - Ay2.z) / 1.6;                                     // slope of the water surface
  // grain: thin dust is a scatter of specks, a thick coat looks even; crust breaks into cracked flakes
  float gs = mix(.3, 1., uGrain), n1 = vnoise(p / gs + uSeed), n2 = vnoise(p / (gs * 3.3) + 17.), n3 = vnoise(p * .9 + 3.1);
  float thin = 1. / (1. + A.x * .6);
  float tauL = A.x * max(0., 1. + (n1 * 1.5 - .75) * (.3 + .7 * thin) + (n2 - .5) * .45);
  float crack = smoothstep(.05, .0, abs(n3 - .5)) * smoothstep(.8, 3., A.y);
  float tauK = A.y * (.75 + .5 * n2) * (1. - .8 * crack);
  float tau = tauL + tauK;
  vec3 col = uDust;
  // mottled at the millimetre scale: patches browner or greyer
  mat2 rot = mat2(.8, .6, -.6, .8);
  float mo1 = .6 * vnoise(p * .3 + 5.) + .4 * vnoise(rot * p * .75 + 1.), mo2 = .6 * vnoise(rot * p * .1 + 11.) + .4 * vnoise(p * .27 + 3.), mo3 = vnoise(p * 1.3 + 2.);
  vec3 browner = col * vec3(1.16, .9, .7), greyer = vec3(dot(col, vec3(.3, .59, .11))) * vec3(.96, 1., 1.05);
  vec3 gcol = mix(col, mix(browner, greyer, mo2), .55 * mo1) * (1. + (mo3 - .5) * .25);
  float wet = clamp(A.w * .8 + A.z * 4., 0., 1.);
  vec3 T = exp(-tau * (1. - .35 * wet) * vec3(1.06, 1., .92));
  // what is behind the glass: sharp where wiped (refracted by water), a dim blurred glow through the dust
  vec3 bgS = behind(vUv + wg * vec2(.012, -.02));
  vec3 bgB = vec3(0.);
  for (int i = 0; i < 8; i++) { float a = float(i) * .7854 + .3; bgB += behind(vUv + vec2(cos(a), sin(a)) * vec2(.022, .039) * (mod(float(i), 2.) < .5 ? 1. : .5)); }
  bgB = (bgB + bgS) / 9.;
  // one cold lamp, low and to the upper left, raking across the glass; the rest of the room is dark
  vec2 toL = normalize(vec2(-.78, -.62));
  vec2 lq = (t - vec2(.3, .3)) * vec2(1., .75);
  float L = .16 + .95 * exp(-dot(lq, lq) * 2.2);
  vec3 lamp = vec3(.76, .87, 1.) * L;
  float relief = -dot(grad, toL);
  float lit = clamp(1. + relief * .34, .22, 3.2) + .12 * smoothstep(3.5, 12., tau);
  vec3 c = bgS * T * 1.7;
  c += bgB * (1. - T) * vec3(.5, .46, .38);                                            // light scattered forward by the dust
  c += gcol * (1. - T) * lit * lamp * (1. - .55 * wet) * .72;
  // coarse particles lying on the dust: fibres, flakes, grit. Where the finger wiped they are gone with the dust.
  float pmm = uPane.x / uRes.x;
  for (int Lr = 0; Lr < 2; Lr++) {
    float cs = Lr == 0 ? 1.5 : 3.4, rmin = Lr == 0 ? .16 : .3, rr = Lr == 0 ? .25 : .45, dn = Lr == 0 ? .3 : .13;
    vec2 q = p / cs + float(Lr) * 17.3, qi = floor(q); vec2 o = (vec2(hash12(qi + 1.3), hash12(qi + 7.9)) - .5) * .36;
    float h = hash12(qi + 3.3), k = hash12(qi + 9.1), dens = dn * smoothstep(.25, 2.5, tauL + .3 * tauK);
    vec2 dv = (fract(q) - .5 - o) * cs; dv = mat2(cos(k * 6.3), sin(k * 6.3), -sin(k * 6.3), cos(k * 6.3)) * dv; dv.x *= 1. + 2.5 * hash12(qi + 4.4);   // flakes and short fibres
    float r = rmin + rr * hash12(qi + 5.7), cover = (1. - smoothstep(r - pmm * .5, r + pmm * .5, length(dv))) * step(h, dens);
    vec3 pc = k < .3 ? vec3(.62, .62, .6) : k < .5 ? vec3(.03) : k < .64 ? vec3(.3, .2, .12) : k < .85 ? vec3(.3, .3, .3) : vec3(.8);
    pc *= .8 + .4 * hash12(qi + 2.2);
    c = mix(c, pc * (lit * lamp * 1.3) + bgB * .03, cover * .9);
  }
  // clean glass has a faint cold sheen and keeps a greasy smear where the finger went
  float clean = T.g * T.g;
  float band = exp(-pow((t.x + t.y * .55 - .5) / .16, 2.)) + .5 * exp(-pow((t.x + t.y * .55 - .93) / .05, 2.));
  c += lamp * clean * (.035 + .1 * band * (.6 + .4 * vnoise(vec2((p.x + p.y * .55) * .5, (p.y - p.x * .55) * .02))));
  // the invisible fingertip: the pad pressed flat on the glass, a rim of light, a breath of condensation round it
  if (uTip.w > 0.) {
    vec2 dp = (p - uTip.xy) * vec2(1., .86); float d = length(dp), r = uTip.z;
    float pad = smoothstep(r * 1.02, r * .8, d), ring = exp(-pow((d - r * .98) / (r * .14), 2.));
    float fog = smoothstep(r * (r > 15. ? 1.7 : 3.2), r * 1.05, d) * (1. - pad) * (.55 + .6 * vnoise(p * 1.4 + 9.)) * uTip.w;
    c = c * (1. - .4 * fog) + fog * (r > 15. ? .05 : .09) * vec3(.8, .92, 1.) * (.4 + L * 2.);
    c = mix(c, c * .6 + lamp * .08, pad * uTip.w * (r > 15. ? .45 : .8));
    c += lamp * ring * uTip.w * step(r, 15.) * (.12 + .28 * max(0., -dot(dp / max(d, 1e-3), toL)));
  }
  if (A.z > 0.) {                                                      // a water drop: a little lens with a glint
    vec3 n = normalize(vec3(-wg * 1.6, 1.));
    c *= 1. - min(.85, (1. - n.z) * 2.2);
    c += bgB * .25 * smoothstep(0., .4, A.z);
    c += vec3(.8, .9, 1.) * pow(max(dot(n, normalize(vec3(toL * .55, 1.))), 0.), 160.) * 2.2;
  }
  float sp = hash12(floor(p / .45) + uSeed);
  c += gcol * step(.9975, sp) * smoothstep(.2, 2., tau) * 2.2 * lamp;                   // a few glinting grains
  gl_FragColor = vec4(tone(c), 1.);
}`;

export async function create({ renderer }) {
  const S = C.create();
  const buf = new Float32Array(N * 4);
  const tex = new THREE.DataTexture(buf, NX, NY, THREE.RGBAFormat, THREE.FloatType);
  const lin = renderer.extensions.has('OES_texture_float_linear');
  tex.minFilter = tex.magFilter = lin ? THREE.LinearFilter : THREE.NearestFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false;
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const uniforms = {
    uA: { value: tex }, uBG: { value: black }, uHasBG: { value: 0 }, uPane: { value: new THREE.Vector2(W, H) }, uRes: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 }, uGrain: { value: C.DUST.grain }, uSeed: { value: 0 }, uTip: { value: new THREE.Vector4() }, uDust: { value: new THREE.Vector3(0.42, 0.35, 0.265) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false });
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);

  let plan = null, key = '', shotT0 = NaN, steps = 0, simT = Infinity, si = 0, st = null, sk = 0;
  const tip = [0, 0, 0, 0];
  const ke = C.DUST.kext;
  function pack() {
    const { D, K, WH, WET } = S;
    for (let c = 0, a = 0; c < N; c++, a += 4) { buf[a] = D[c] * ke; buf[a + 1] = K[c] * ke; buf[a + 2] = WH[c]; buf[a + 3] = WET[c]; }
    tex.needsUpdate = true; S.dirty = false;
  }
  // draw every stroke up to shot-local time `time`
  function advance(time) {
    while (si < plan.strokes.length) {
      const P = plan.strokes[si];
      if (time < P.t0) break;
      if (!st) { st = C.begin(S, P.tool, P.pts[0][0], P.pts[0][1], P.seed); C.move(S, st, P.pts[0][0], P.pts[0][1], P.r, P.press); sk = 0; }
      const target = P.len * Math.min(1, (time - P.t0) / Math.max(1e-6, P.t1 - P.t0));
      while (sk + 1 < P.pts.length && P.cum[sk + 1] <= target) { sk++; C.move(S, st, P.pts[sk][0], P.pts[sk][1], P.r, P.press); }
      if (time >= P.t1) {
        while (sk + 1 < P.pts.length) { sk++; C.move(S, st, P.pts[sk][0], P.pts[sk][1], P.r, P.press); }
        C.end(S, st, P.r); st = null; si++;
      } else {
        if (sk + 1 < P.pts.length) { const a = P.pts[sk], b = P.pts[sk + 1], q = (target - P.cum[sk]) / (P.cum[sk + 1] - P.cum[sk]); C.move(S, st, a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, P.r, P.press); }
        break;
      }
    }
  }
  let backdrop = null;
  return {
    update(t, shot) {
      const dur = shot.dur > 60 || !(shot.dur > 0) ? 8 : shot.dur, seed = Number.isFinite(+shot.seed) ? +shot.seed : 1;
      const mode = meta.modes.includes(shot.mode) ? shot.mode : 'write', drops = Math.max(0, Math.min(1, shot.drops ?? 0.3));
      const k = [mode, shot.text ?? '', seed, dur, drops].join('\u0001');
      if (k !== key) { key = k; plan = buildPlan(mode, shot.text, seed, dur); simT = Infinity; }
      if (shot.t0 !== shotT0 || shot.lt < simT - 1e-9) {     // another shot, or a seek backwards: start over
        shotT0 = shot.t0; C.reset(S, seed); steps = 0; simT = 0; si = 0; st = null; sk = 0;
      }
      const target = Math.min(shot.lt, plan.tSimEnd), pDrop = Math.min(1, drops * 0.8);
      while (simT < target) {
        const prev = simT; steps++; simT = steps * DT;
        advance(simT);
        // water drops land near the top on beats (song time), chosen by beat number and seed
        if (pDrop > 0 && simT >= plan.dropFrom && prev <= plan.dropTo) {
          for (let b = Math.floor((shot.t0 + prev - BEAT0) / BEAT) + 1; BEAT0 + b * BEAT <= shot.t0 + simT; b++) {
            if (C.hash1(b * 1.37 + seed * 17.1) >= pDrop) continue;
            C.land(S, (0.05 + 0.9 * C.hash1(b * 3.11 + seed * 5.3)) * W, (0.02 + 0.3 * C.hash1(b * 7.7 + seed * 2.9)) * H, 3 + 1.7 * C.hash1(b * 5.9 + seed));
          }
        }
        C.step(S, DT, DT * 10);
      }
      if (S.dirty) pack();
      tipAt(plan, shot.lt, tip);
      uniforms.uTip.value.set(tip[0], tip[1], tip[2], tip[3]);
      uniforms.uTime.value = t; uniforms.uSeed.value = (seed * 13.7) % 97;
      backdrop = shot.backdrop || null;
    },
    render(r, target) {
      uniforms.uBG.value = backdrop || black; uniforms.uHasBG.value = backdrop ? 1 : 0;
      const ac = r.autoClear; r.autoClear = false;
      r.setRenderTarget(target); r.render(scene, camera);
      r.autoClear = ac;
    },
  };
}

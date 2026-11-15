// ink.js: a handwritten love note on filter paper meets water. Port of assets/ink-chromatography (WebGL2, float
// render targets): the ink is a mix of four dyes; water wicks through the paper and each dye travels at its own
// pace (its Rf), so the black handwriting comes apart into coloured bands and smears away.
//
// Modes:
//   wick   the sheet hangs with its lower edge in sickly green vat fluid; the front climbs and reaches the top of
//          the sheet at the end of the shot (speed chosen from shot.dur)
//   drops  the sheet lies on wet steel; drops land on the beat grid and bloom
//   soak   water comes in from all edges, fast; the note is fully dissolved into colour by the end of the shot
// Parameters: text (lines separated by "\n" or "|"), seed, ink ('black' | 'red').
import { BEAT, BEAT0 } from '../audio.js';

export const meta = {
  modes: ['wick', 'drops', 'soak'],
  params: { span: 'optional: seconds until the note has separated (default: the shot length)', text: 'the note, 1-3 lines separated by "\\n"', seed: 'integer; layout, drops and paper tilt', ink: "'black' (default) | 'red'" },
};

const W = 1920, H = 1080;
const SW = 960, SH = 512;             // simulation grid = the sheet of paper
const PW = 1680, PH = 896;            // the sheet on screen (px)
const SRC = 37;                       // wick: the lowest cells stand in the fluid
const TSIM = 14;                      // drops/soak: simulated seconds that a whole shot spans
const DTS = 1 / 30;                   // drops/soak: fixed simulation step (simulated seconds)
const DTW = 1 / 60;                   // wick: fixed step (shot seconds)

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- dyes and inks (from the experiment; water as the solvent)
const DYES = [
  { absorb: [0.03, 0.16, 1.7], rf: 0.86 },    // yellow
  { absorb: [0.1, 1.55, 0.5], rf: 0.6 },      // magenta
  { absorb: [1.7, 0.55, 0.12], rf: 0.34 },    // blue (cyan-ish when thin)
  { absorb: [0.85, 1.35, 0.25], rf: 0.12 },   // violet
];
const INKS = { black: [1, 1, 1, 1], red: [0.75, 1.7, 0, 0.12] };
const RF = DYES.map(d => d.rf);
const PAPER = [0.955, 0.945, 0.91];

// ---------- paper texture: R = grain, G = how well fibres wick, B = how much it holds
function valueNoise(w, h, cell, rand) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2, g = new Float32Array(gw * gh), out = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  for (let y = 0; y < h; y++) {
    const fy = y / cell, j = Math.floor(fy), ty = fy - j, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x++) {
      const fx = x / cell, i = Math.floor(fx), tx = fx - i, sx = tx * tx * (3 - 2 * tx), o = j * gw + i;
      const a = g[o] + (g[o + 1] - g[o]) * sx, b = g[o + gw] + (g[o + gw + 1] - g[o + gw]) * sx;
      out[y * w + x] = a + (b - a) * sy;
    }
  }
  return out;
}
function fbm(w, h, cells, rand) {
  const out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (const c of cells) { const n = valueNoise(w, h, c, rand); for (let i = 0; i < out.length; i++) out[i] += amp * n[i]; tot += amp; amp *= 0.55; }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function fibres(w, h, rand, density, lenMax) {
  const fib = new Float32Array(w * h), n = Math.round(w * h / density);
  for (let k = 0; k < n; k++) {
    let x = rand() * w, y = rand() * h, a = rand() * Math.PI;
    const len = 5 + lenMax * rand() * rand(), bend = (rand() - 0.5) * 0.12, wt = 0.25 + 0.35 * rand();
    for (let s = 0; s < len; s++) {
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi >= 0 && yi >= 0 && xi < w && yi < h) fib[yi * w + xi] += wt;
      x += Math.cos(a); y += Math.sin(a); a += bend;
    }
  }
  return fib;
}
function makePaper(w, h, seed) {
  const rand = rng(seed);
  const grain = fbm(w, h, [2, 4, 9, 23], rand), hold = fbm(w, h, [6, 17, 41], rand), wick = fbm(w, h, [3, 11, 30], rand);
  const fib = fibres(w, h, rand, 55, 28);
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = Math.round(255 * Math.min(1, Math.max(0, (grain[i] - 0.5) * 1.8 + 0.5)));
    out[i * 4 + 1] = Math.round(255 * Math.min(1, 0.18 + 0.55 * Math.pow(wick[i], 1.6) + 0.55 * fib[i]));
    out[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, (hold[i] - 0.5) * 1.6 + 0.5)));
    out[i * 4 + 3] = 255;
  }
  return out;
}
// display-only fibre detail at screen resolution: R = fibres, G = fine grain, B = cloudy formation
function makeFibreDetail(w, h, seed) {
  const rand = rng(seed), fib = fibres(w, h, rand, 38, 60), grain = fbm(w, h, [1.5, 3, 7], rand), cloud = fbm(w, h, [18, 50, 130], rand);
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = Math.round(255 * Math.min(1, fib[i] * 0.9));
    out[i * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, (grain[i] - 0.5) * 2.2 + 0.5)));
    out[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, (cloud[i] - 0.5) * 2.4 + 0.5)));
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------- shaders (simulation passes copied from the experiment)
const VS = `#version 300 es
in vec2 aP; void main() { gl_Position = vec4(aP, 0., 1.); }`;
const HEAD = `#version 300 es
precision highp float;
uniform sampler2D uA, uG, uD, uP;
uniform ivec2 uN;
uniform float uDt;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oG;
layout(location = 2) out vec4 oD;
const float EPS = 2e-4;
ivec2 cl(ivec2 c) { return clamp(c, ivec2(0), uN - 1); }
vec4 A(ivec2 c) { return texelFetch(uA, cl(c), 0); }
vec4 G(ivec2 c) { return texelFetch(uG, cl(c), 0); }
vec4 D(ivec2 c) { return texelFetch(uD, cl(c), 0); }
vec4 P(ivec2 c) { return texelFetch(uP, cl(c), 0); }
const ivec2 XL = ivec2(-1, 0), XR = ivec2(1, 0), YD = ivec2(0, -1), YU = ivec2(0, 1);
`;
const FS_INIT = HEAD + `
uniform sampler2D uM; uniform float uInk;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  oA = vec4(0.); oG = vec4(0.);
  oD = texelFetch(uM, c, 0) * uInk * (.92 + .16 * P(c).r);
}`;
const FS_DROP = HEAD + `
uniform vec4 uDr[16]; uniform vec4 uE[16]; uniform int uND;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c);
  for (int i = 0; i < 16; i++) {
    if (i >= uND) break;
    vec2 q = vec2(c) - uDr[i].xy; float L = length(q), ang = atan(q.y, q.x), sd = uE[i].w;
    float rr = uDr[i].z * (1. + .18 * sin(3. * ang + sd) + .1 * sin(7. * ang + 2. * sd) + .06 * sin(13. * ang + 5. * sd));
    float k = 1. - smoothstep(rr * .55, rr, L);
    if (k <= 0.) continue;
    a.x += uDr[i].w * k;
    a.yz += k * (uE[i].x * (L > .5 ? q / L : vec2(0.)) * (L / max(rr, 1.)) * 60. + uE[i].yz);
  }
  oA = a; oG = G(c); oD = D(c);
}`;
const FS_FLOW = HEAD + `
uniform float uGrav, uDrag, uRough, uEdge, uVisc; uniform vec4 uTilt;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c), al = A(c + XL), ar = A(c + XR), ad = A(c + YD), au = A(c + YU);
  float pl = al.x + uRough * P(c + XL).r, pr = ar.x + uRough * P(c + XR).r, pd = ad.x + uRough * P(c + YD).r, pu = au.x + uRough * P(c + YU).r;
  vec2 grad = .5 * vec2(pr - pl, pu - pd);
  vec2 gm = .5 * vec2(step(EPS, ar.x) - step(EPS, al.x), step(EPS, au.x) - step(EPS, ad.x));
  vec2 vel = mix(a.yz, .25 * (al.yz + ar.yz + ad.yz + au.yz), uVisc);
  vel += uDt * (-uGrav * grad - uEdge * gm + uTilt.xy);
  vel *= exp(-uDrag * uDt);
  if (a.x < EPS) vel = vec2(0.);
  float sp = length(vel) * uDt; if (sp > .24) vel *= .24 / sp;
  oA = vec4(a.x, vel, a.w); oG = G(c); oD = D(c);
}`;
const FS_ADVECT = HEAD + `
uniform vec4 uRf;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c), al = A(c + XL), ar = A(c + XR), ad = A(c + YD), au = A(c + YU);
  vec4 g = G(c), gL = G(c + XL), gr = G(c + XR), gd = G(c + YD), gu = G(c + YU);
  float uR = .5 * (a.y + ar.y) * uDt, uL = .5 * (al.y + a.y) * uDt, vU = .5 * (a.z + au.z) * uDt, vD = .5 * (ad.z + a.z) * uDt;
  float hR = uR * (uR > 0. ? a.x : ar.x), hL = uL * (uL > 0. ? al.x : a.x), hU = vU * (vU > 0. ? a.x : au.x), hD = vD * (vD > 0. ? ad.x : a.x);
  vec4 fR = uRf * uR * (uR > 0. ? g : gr), fL = uRf * uL * (uL > 0. ? gL : g), fU = uRf * vU * (vU > 0. ? g : gu), fD = uRf * vD * (vD > 0. ? gd : g);
  oA = vec4(max(0., a.x + hL - hR + hD - hU), a.yzw);
  oG = max(vec4(0.), g + fL - fR + fD - fU);
  oD = D(c);
}`;
// invasion-percolation wicking; each dye rides along with the wicking water at its Rf
const FS_PAPER = HEAD + `
uniform float uAbs, uCap, uThr, uCarry, uLift, uDep, uEvap, uEvapS, uEdgeEvap, uFibre;
uniform vec4 uRf;
float K(vec4 p) { return mix(.6, .15 + 1.35 * p.g, uFibre); }
float T(vec4 p) { return uThr * mix(1., .25 + 2.2 * (1. - p.g) * (.5 + p.b), uFibre); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c), g = G(c), d = D(c), p = P(c);
  float h = a.x, s = a.w;
  float cap = .25 + .75 * p.b;
  float ab = min(h, uAbs * uDt * max(0., cap - s)); h -= ab; s += ab;
  vec4 conc = g / (h + s + 1e-3), dg = vec4(0.);
  float ds = 0., wetN = 0., k0 = K(p), t0 = T(p);
  ivec2 o[4] = ivec2[4](XL, XR, YD, YU);
  for (int i = 0; i < 4; i++) {
    vec4 an = A(c + o[i]), gn = G(c + o[i]), pn = P(c + o[i]);
    float kf = min(k0, K(pn)), th = max(t0, T(pn));
    float q = uCap * uDt * kf * smoothstep(th, th + .06, max(s, an.w)) * (an.w - s);
    ds += q;
    dg += uCarry * uRf * (q > 0. ? q * gn / (an.x + an.w + 1e-3) : q * conc);
    wetN += step(EPS, an.x);
  }
  s = max(0., s + ds); g = max(vec4(0.), g + dg);
  float wet = clamp(h * 40. + s * 1.6, 0., 1.);
  vec4 lift = uLift * uDt * wet * d;
  float thin = 1. - smoothstep(0., .025, h);
  vec4 dep = uDep * uDt * g * (.15 + 2.5 * thin * (1. - .6 * smoothstep(.1, .5, s)));
  d = max(vec4(0.), d + dep - lift); g = max(vec4(0.), g + lift - dep);
  float edge = clamp(step(EPS, h) * (1. - wetN * .25) * 2., 0., 1.);
  h = max(0., h - uDt * uEvap * (1. + uEdgeEvap * edge));
  if (h < EPS) { h = 0.; s = max(0., s - uDt * uEvapS * (.4 + p.b)); }
  if (h == 0. && s < .03) { d += g; g = vec4(0.); }
  oA = vec4(h, h == 0. ? vec2(0.) : a.yz, s); oG = g; oD = d;
}`;
// wick: the experiment's paper strip. The front's height is prescribed (uRise, cells above the fluid), a little
// different in every column (uF); the liquid behind it moves up at the front's speed and dye i rides it at Rf_i.
// The ink dissolves gradually once wet (uLift), so each stroke trails colour upward.
const FS_STRIP = HEAD + `
uniform sampler2D uF;
uniform float uRise, uDr, uTop, uSrc, uDiff, uLift;
uniform vec4 uRf;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 g = G(c), d = D(c), gb = G(c + YD), gl = G(c + XL), gr = G(c + XR), gu = G(c + YU);
  float f = texelFetch(uF, ivec2(c.x, 0), 0).r, span = uTop - uSrc;
  float done = step(span, uRise * f), front = uSrc + min(uRise * f, span), v = f * uDr * (done > 0. ? .15 : 1.);
  float y = float(c.y), wet = 1. - smoothstep(front - 1.5, front + 1.5, y), wetUp = 1. - smoothstep(front - 1.5, front + 1.5, y + 1.);
  if (y + 1.5 > float(uN.y)) wetUp = 0.;
  float loc = .72 + .7 * P(c).g, locb = .72 + .7 * P(c + YD).g;
  vec4 mc = uRf * v * loc, mb = uRf * v * locb, lift = d * wet * uLift;
  vec4 lap = gl + gr + gu * wetUp + gb - (3. + wetUp) * g;
  g += wet * (mb * gb - mc * g * wetUp + uDiff * lap) + lift;
  d -= lift;
  oA = vec4(0., 0., 0., max(wet, y < uSrc ? 1. : 0.)); oG = max(g, vec4(0.)); oD = max(d, vec4(0.));
}`;
// the picture: dyes absorb light on the paper (Beer–Lambert); dim cold light; dark steel or the vat fluid around it
const FS_SHOW = `#version 300 es
precision highp float;
uniform sampler2D uA, uG, uD, uP, uX;
uniform ivec2 uN; uniform vec3 uAbsorb[4]; uniform vec3 uPaper;
uniform vec4 uCam;      // zoom, rotation, offset x, y
uniform vec4 uSheet;    // centre x, y (px, y up), rotation, mode (0 wick, 1 flat)
uniform vec2 uSize;     // sheet size in px
uniform float uT, uPulse, uFluidY, uSeed;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
vec4 bil(sampler2D t, vec2 g) {
  g = clamp(g, vec2(0.), vec2(uN) - 1.001); ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
  vec4 a = texelFetch(t, i, 0), b = texelFetch(t, i + ivec2(1, 0), 0), c = texelFetch(t, i + ivec2(0, 1), 0), d = texelFetch(t, i + ivec2(1, 1), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.)) + min(max(d.x, d.y), 0.); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float sheetD(vec2 q) {
  vec2 r = rot(q - uSheet.xy, -uSheet.z);
  return sdBox(r, uSize * .5 - 8.) - 8. + 2.2 * (vn(r * .035 + uSeed) - .5) + 1.2 * (vn(r * .15 + uSeed) - .5);
}
vec3 steel(vec2 q) {
  float br = .6 * vn(vec2(q.x * .004, q.y * .4)) + .4 * vn(vec2(q.x * .02, q.y * 1.4));
  float band = exp(-pow((q.y - 700. - .16 * q.x) / 300., 2.));
  vec3 c = vec3(.012, .015, .018) + vec3(.03, .04, .047) * br * (.3 + 1.3 * band);
  float pud = smoothstep(.5, .6, vn(q * .007 + 3. + uSeed));
  c = mix(c, c * .4 + vec3(0., .01, .004), pud * .8) + pud * band * vec3(.012, .03, .022);
  return c;
}
vec3 wall(vec2 q) {
  float n = vn(q * .004 + uSeed) * .6 + vn(q * .02) * .4;
  return vec3(.008, .011, .012) * (.6 + n) + vec3(.02, .06, .012) * exp(-max(q.y - uFluidY, 0.) / 300.) * (.6 + .4 * n);
}
void main() {
  vec2 C = vec2(960., 540.);
  vec2 q = C + rot(gl_FragCoord.xy - C, uCam.y) / uCam.x + uCam.zw;
  bool flat_ = uSheet.w > .5;
  // cold fluorescent light from the upper left, falling off; in wick mode the fluid glows from below
  vec2 lp = vec2(760., 760.);
  float spot = exp(-dot(q - lp, q - lp) / (980. * 980.));
  vec3 light = vec3(.80, .92, 1.) * (.16 + .50 * spot) * (.93 + .07 * uPulse);
  float surf = uFluidY + 2.5 * sin(q.x * .011 + uT * .9) + 1.5 * sin(q.x * .027 - uT * 1.3);
  if (!flat_) light += vec3(.20, .50, .10) * (.30 * exp(-max(q.y - surf, 0.) / 170.)) * (.85 + .15 * uPulse);

  vec3 col = flat_ ? steel(q) : wall(q);
  float d = sheetD(q);
  // shadow under / behind the sheet
  float ds = sheetD(q - vec2(14., -18.));
  col *= 1. - .8 * (1. - smoothstep(-6., 46., ds));
  if (d < 1.) {
    vec2 r = rot(q - uSheet.xy, -uSheet.z), uv = r / uSize + .5, g = uv * vec2(uN) - .5;
    vec4 a = bil(uA, g), dye = bil(uD, g) + .85 * bil(uG, g), p = bil(uP, g), x = texture(uX, uv);
    vec3 ab = uAbsorb[0] * dye.x + uAbsorb[1] * dye.y + uAbsorb[2] * dye.z + uAbsorb[3] * dye.w;
    float tex = .80 + .10 * p.r + .05 * p.g + .13 * (x.g - .5) + .10 * (x.b - .5) + .2 * x.r;
    vec3 paper = uPaper * tex;
    float wet = clamp(a.x * 20. + a.w * .62, 0., 1.);
    paper *= 1. - (flat_ ? .30 : .42) * wet;                                  // wet paper turns translucent and dark
    paper = mix(paper, paper * vec3(.86, .98, .84), wet * .6); // and the vat fluid is a little green
    vec3 pc = paper * exp(-ab) * light;
    // standing water and soaked fibres catch the light
    float hx = bil(uA, g + vec2(2.5, 0.)).x - bil(uA, g - vec2(2.5, 0.)).x, hy = bil(uA, g + vec2(0., 2.5)).x - bil(uA, g - vec2(0., 2.5)).x;
    vec3 nrm = normalize(vec3(-vec2(hx, hy) * 3., 1.));
    float film = clamp(a.x * 30., 0., 1.);
    float spec = pow(max(dot(nrm, normalize(vec3(-.28, .42, .86))), 0.), 140.) * film;
    pc += vec3(.75, .9, 1.) * (.16 * spec + .025 * film * spot) + vec3(.7, .9, .8) * .028 * wet * smoothstep(.55, .9, x.g) * spot;
    pc *= 1. - .25 * smoothstep(-7., 1., d);                  // edge of the sheet
    col = mix(col, pc, smoothstep(1., -1., d));
  }
  if (!flat_) {   // the dish of vat fluid in front of the sheet's foot
    float dep = surf - q.y;
    if (dep > 0.) {
      vec3 fl = vec3(.035, .10, .02) * (.7 + .5 * vn(vec2(q.x * .006 + uT * .05, q.y * .02))) + vec3(.03, .085, .012) * smoothstep(0., 200., dep);
      col = mix(col * vec3(.5, .9, .42), fl, .55 + .3 * smoothstep(0., 160., dep));
    }
    col += vec3(.30, .55, .16) * exp(-abs(dep) / 2.2) * .22 + vec3(.2, .4, .1) * exp(-abs(dep + 7.) / 5.) * step(d, 0.) * .10;
  }
  o = vec4(pow(max(col, 0.), vec3(1. / 2.2)), 1.);
}`;

export async function create() {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('ink: WebGL2 with float render targets is required');
  try { await document.fonts.load('700 100px Caveat'); } catch (_) { /* falls back to cursive */ }

  // ---------- GL plumbing
  const shader = (src, type) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = fs => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(VS, gl.VERTEX_SHADER)); gl.attachShader(p, shader(fs, gl.FRAGMENT_SHADER));
    gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  };
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const tex = (w, h, internal, format, type, data, filter = gl.NEAREST) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    return t;
  };
  // state: A = (surface water h, velocity u, v, water held in the paper s); G = dyes afloat; D = dyes settled
  const mk = () => [0, 1].map(() => tex(SW, SH, gl.RGBA32F, gl.RGBA, gl.FLOAT, null));
  const A = mk(), G = mk(), D = mk();
  const fbo = [0, 1].map(i => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    [A, G, D].forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t[i], 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('ink: float framebuffer incomplete');
    return f;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let cur = 0;
  const paperTex = tex(SW, SH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, makePaper(SW, SH, 11));
  const detailTex = tex(1680, 896, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, makeFibreDetail(1680, 896, 23), gl.LINEAR);
  const maskTex = tex(SW, SH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(SW * SH * 4));
  const frontTex = tex(SW, 1, gl.R32F, gl.RED, gl.FLOAT, new Float32Array(SW));

  const pInit = program(FS_INIT), pDrop = program(FS_DROP), pFlow = program(FS_FLOW), pAdvect = program(FS_ADVECT),
    pPaper = program(FS_PAPER), pStrip = program(FS_STRIP), pShow = program(FS_SHOW);

  function bindState(Pg) {
    [[A, 'uA'], [G, 'uG'], [D, 'uD']].forEach(([t, n], k) => { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, t[cur]); gl.uniform1i(Pg.u[n], k); });
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(Pg.u.uP, 3);
    if (Pg.u.uM) { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(Pg.u.uM, 4); }
    if (Pg.u.uF) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, frontTex); gl.uniform1i(Pg.u.uF, 5); }
    if (Pg.u.uX) { gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, detailTex); gl.uniform1i(Pg.u.uX, 6); }
    gl.uniform2i(Pg.u.uN, SW, SH);
  }
  function pass(Pg, uniforms = {}) {
    gl.useProgram(Pg.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1 - cur]);
    gl.viewport(0, 0, SW, SH);
    bindState(Pg);
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = Pg.u[k]; if (!loc) continue;
      if (v instanceof Float32Array || Array.isArray(v)) gl.uniform4fv(loc, v);
      else if (k === 'uND') gl.uniform1i(loc, v);
      else gl.uniform1f(loc, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = 1 - cur;
  }

  // ---------- the note: handwriting painted into the dye mask
  const maskCv = document.createElement('canvas'); maskCv.width = SW; maskCv.height = SH;
  const mx = maskCv.getContext('2d', { willReadFrequently: true });
  let inkPts = [], edgePts = [];
  function paintMask(text, seed, ink, mode) {
    const rand = rng(seed * 7919 + 17);
    const lines = String(text).split(/\n|\|/).map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (!lines.length) lines.push('Stay wet, baby');
    mx.setTransform(1, 0, 0, 1, 0, 0); mx.clearRect(0, 0, SW, SH);
    mx.fillStyle = '#fff'; mx.textAlign = 'center'; mx.textBaseline = 'alphabetic';
    const fam = '"Caveat", "Segoe Script", cursive';
    let size = 200;
    mx.font = `700 ${size}px ${fam}`;
    const widest = Math.max(...lines.map(l => mx.measureText(l).width));
    const wantW = 0.75 * W / PW * SW, LH = 0.8, maxH = (mode === 'wick' ? 0.60 : 0.66) * SH;
    size = Math.min(size * wantW / Math.max(1, widest), maxH / (lines.length * LH + 0.25));
    mx.font = `700 ${size}px ${fam}`; mx.strokeStyle = '#fff'; mx.lineJoin = 'round'; mx.lineWidth = size * 0.022;
    const lh = size * LH, cy = SH * (mode === 'wick' ? 0.455 : 0.47), tilt = (rand() - 0.5) * 0.07;
    mx.translate(SW / 2, cy); mx.rotate(tilt);
    lines.forEach((l, i) => {
      const y = (i - (lines.length - 1) / 2) * lh + size * 0.27 + (rand() - 0.5) * size * 0.06;
      const wl = mx.measureText(l).width, slack = Math.max(0, (SW * 0.94 - wl) / 2), dx = (rand() - 0.5) * Math.min(slack, SW * 0.012) * 2;
      mx.save(); mx.translate(dx, y); mx.rotate((rand() - 0.5) * 0.03); mx.transform(1, 0, (rand() - 0.5) * 0.08, 1, 0, 0);
      mx.fillText(l, 0, 0); mx.strokeText(l, 0, 0); mx.restore();
    });
    mx.setTransform(1, 0, 0, 1, 0, 0);
    const img = mx.getImageData(0, 0, SW, SH).data, out = new Uint8Array(SW * SH * 4), mix = INKS[ink] || INKS.black;
    inkPts = []; edgePts = [];
    const at = (x, y) => x >= 0 && y >= 0 && x < SW && y < SH && img[(y * SW + x) * 4 + 3] > 128;
    for (let yy = 0; yy < SH; yy++) for (let xx = 0; xx < SW; xx++) {
      const a = img[(yy * SW + xx) * 4 + 3]; if (!a) continue;
      const o = ((SH - 1 - yy) * SW + xx) * 4;
      // pen pressure: the stroke is a touch uneven
      for (let k = 0; k < 4; k++) out[o + k] = Math.min(255, Math.round(a * mix[k] / 1.3));
      if (a > 128 && yy % 3 === 0 && xx % 3 === 0) {
        inkPts.push([xx, SH - 1 - yy]);
        if (!at(xx - 6, yy) || !at(xx + 6, yy) || !at(xx, yy - 6) || !at(xx, yy + 6)) edgePts.push([xx, SH - 1 - yy]);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SW, SH, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // wick: how fast each column of the paper draws the fluid up (smooth, a few scales)
    const f = new Float32Array(SW), ph = [rand(), rand(), rand(), rand()].map(v => v * 6.283);
    for (let x = 0; x < SW; x++) f[x] = 0.9 + 0.05 * Math.sin(x / 190 + ph[0]) + 0.03 * Math.sin(x / 67 + ph[1]) + 0.018 * Math.sin(x / 23 + ph[2]) + 0.008 * Math.sin(x / 9 + ph[3]);
    gl.bindTexture(gl.TEXTURE_2D, frontTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, SW, 1, 0, gl.RED, gl.FLOAT, f);
  }

  // ---------- drop schedules; times are in simulated seconds (shot seconds × TSIM / dur)
  function scheduleDrops(S) {
    const rand = rng(S.seed * 104729 + 5), ev = [], K = TSIM / S.dur;
    const pick = list => list[Math.floor(rand() * list.length)];
    if (!inkPts.length) return ev;
    if (S.mode === 'drops') {
      // on the beat grid: beat k is at BEAT0 + k * BEAT (song time)
      const k0 = Math.ceil((S.t0 + 0.3 - BEAT0) / BEAT), nBeats = Math.max(1, Math.floor((S.dur * 0.86 - 0.3) / BEAT));
      const stride = Math.max(1, Math.round(nBeats / 11)), n = Math.min(14, Math.ceil(nBeats / stride));
      for (let i = 0; i < n; i++) {
        const lt = BEAT0 + (k0 + i * stride) * BEAT - S.t0;
        const [x, y] = rand() < 0.75 && edgePts.length ? pick(edgePts) : pick(inkPts);
        const r = (i < 2 ? 34 : 28) + 42 * rand() * rand();
        ev.push({ t: lt * K, x: x + (rand() - 0.5) * r * 0.5, y: y + (rand() - 0.5) * r * 0.5, r, amt: 5 + 3 * rand(), splash: 0.3 + 0.5 * rand(), sd: rand() * 6.283 });
      }
    } else {   // soak: from all edges inward
      const n = 44;
      for (let i = 0; i < n; i++) {
        let x, y;
        if (i < 16) { const s = rand(), side = i % 4; x = side < 2 ? s * SW : (side === 2 ? 20 : SW - 20); y = side < 2 ? (side === 0 ? 16 : SH - 16) : s * SH; }
        else if (i < 34) [x, y] = pick(inkPts);
        else { x = rand() * SW; y = rand() * SH; }
        const e = Math.min(1, Math.min(x, SW - x, y, SH - y) / (SH * 0.5));
        const r = 70 + 60 * rand();
        ev.push({ t: TSIM * (0.015 + 0.5 * Math.pow(e, 1.2) + 0.04 * rand()), x, y, r, amt: 2.6 + 1.6 * rand(), splash: 0.08 + 0.15 * rand(), sd: rand() * 6.283 });
      }
    }
    return ev.sort((p, q) => p.t - q.t);
  }

  // ---------- simulation
  const FLOW = { uGrav: 600, uDrag: 3, uRough: 0.01, uEdge: 0, uVisc: 0.15 };
  const PAPERP = { uAbs: 8, uCap: 38, uThr: 0.14, uCarry: 1, uLift: 6, uDep: 0.04, uEvap: 0.025, uEvapS: 0.011, uEdgeEvap: 1.5, uFibre: 0.85, uRf: RF };
  const SUB = 4, CLOCK = 3.4;
  let S = null, simT = 0, schedule = [], nextEv = 0;
  function reset(S_) {
    S = S_;
    paintMask(S.text, S.seed, S.ink, S.mode);
    const inkAmt = S.mode === 'wick' ? 1.7 : S.ink === 'red' ? 2.3 : 3.2;
    pass(pInit, { uInk: inkAmt }); pass(pInit, { uInk: inkAmt });
    simT = 0; nextEv = 0;
    const tr = rng(S.seed * 613 + 1), ta = -Math.PI / 2 + (tr() - 0.5) * 0.9, tg = S.mode === 'soak' ? 80 : 26;
    S.tilt = [Math.cos(ta) * tg, Math.sin(ta) * tg, 0, 0];
    schedule = S.mode === 'wick' ? [] : scheduleDrops(S);
  }
  function stepLetters() {
    simT += DTS;
    const pend = [];
    while (nextEv < schedule.length && schedule[nextEv].t <= simT) pend.push(schedule[nextEv++]);
    while (pend.length) {
      const n = Math.min(16, pend.length), Dr = new Float32Array(64), E = new Float32Array(64);
      for (let i = 0; i < n; i++) { const e = pend.shift(); Dr.set([e.x, e.y, e.r, e.amt], i * 4); E.set([e.splash, 0, 0, e.sd], i * 4); }
      pass(pDrop, { uDr: Dr, uE: E, uND: n, uDt: 0 });
    }
    const d = DTS / SUB, dtMax = 0.22 / (PAPERP.uCap * 1.5), n = Math.min(6, Math.max(1, Math.ceil(CLOCK * d / dtMax))), dp = Math.min(dtMax, CLOCK * d / n);
    for (let s = 0; s < SUB; s++) {
      pass(pFlow, { ...FLOW, uTilt: S.tilt, uDt: d }); pass(pAdvect, { uDt: d, uRf: RF });
      for (let k = 0; k < n; k++) pass(pPaper, { ...PAPERP, uDt: dp });
    }
  }
  // wick: the front's rise (cells above the fluid) as a function of shot progress; it tops out as the shot ends
  const SPAN = SH - 4 - SRC;
  const riseAt = p => SPAN / 0.84 * Math.pow(Math.max(0, p - 0.02), 0.82);   // ÷0.84: even the slowest column arrives
  function stepWick() {
    const r0 = riseAt(simT / S.dur); simT += DTW; const r1 = riseAt(simT / S.dur);
    if (r1 <= r0 || r0 > SPAN * 1.8) return;
    const n = Math.max(1, Math.ceil((r1 - r0) / 0.26));
    for (let k = 0; k < n; k++) {
      const dr = (r1 - r0) / n;
      pass(pStrip, { uRise: r0 + (k + 1) * dr, uDr: dr, uTop: SH - 4, uSrc: SRC, uDiff: 0.01, uLift: 1 - Math.exp(-dr / 27), uRf: RF, uDt: 0 });
    }
  }

  const px = new Uint8Array(4);
  const absorb = new Float32Array(DYES.flatMap(d => d.absorb));
  function render(shot, lt) {
    const rand = rng(S.seed * 31337 + 3), ph = [rand(), rand(), rand(), rand()].map(v => v * 6.283), sgn = rand() < 0.5 ? -1 : 1;
    const pe = Math.min(1.5, lt / S.dur), wick = S.mode === 'wick';
    const zoom = 1.03 + 0.075 * pe + 0.006 * Math.sin(lt * 0.31 + ph[0]);
    const camRot = 0.007 * Math.sin(lt * 0.23 + ph[1]) + sgn * 0.006 * (pe - 0.5);
    const ox = 16 * Math.sin(lt * 0.19 + ph[2]) + sgn * 22 * (pe - 0.5), oy = 9 * Math.sin(lt * 0.27 + ph[3]) + (wick ? -14 + 44 * pe : 12 * (pe - 0.5));
    const tilt = (rand() - 0.5) * (wick ? 0.012 : 0.05) + (wick ? 0.004 * Math.sin(lt * 0.5 + ph[0]) : 0);
    const cy = H - 505;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(pShow.p);
    bindState(pShow);
    gl.uniform3fv(pShow.u.uAbsorb, absorb);
    gl.uniform3fv(pShow.u.uPaper, PAPER);
    gl.uniform4f(pShow.u.uCam, zoom, camRot, ox, oy);
    gl.uniform4f(pShow.u.uSheet, 960, cy, tilt, wick ? 0 : 1);
    gl.uniform2f(pShow.u.uSize, PW, PH);
    gl.uniform1f(pShow.u.uT, lt);
    gl.uniform1f(pShow.u.uPulse, shot.beat ? shot.beat.pulse : 0);
    gl.uniform1f(pShow.u.uFluidY, cy - PH / 2 + SRC / SH * PH);
    gl.uniform1f(pShow.u.uSeed, (S.seed % 97) * 1.37);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // wait for the GPU: the picture is complete on return
  }

  return {
    canvas,
    update(t, shot) {
      const mode = meta.modes.includes(shot.mode) ? shot.mode : 'wick';
      const d0 = shot.span > 0 ? +shot.span : shot.dur;   // span: optional override of the time the separation takes
      const dur = !(d0 > 0) || d0 > 60 ? 8 : Math.min(14, Math.max(2, d0));
      const key = [shot.t0, mode, shot.text, shot.seed, shot.ink, dur].join('\u0001');
      const lt = Math.max(0, shot.lt);
      const target = mode === 'wick' ? Math.min(lt, dur * 1.6) : Math.min(lt, dur * 1.5) * TSIM / dur;
      if (!S || S.key !== key || target < simT - 1e-6) {
        reset({ key, mode, dur, t0: shot.t0 || 0, text: shot.text ?? 'Stay wet, baby', seed: Math.round(+shot.seed || 0) + 1, ink: shot.ink === 'red' ? 'red' : 'black' });
      }
      if (mode === 'wick') while (simT + DTW <= target + 1e-6) stepWick();
      else while (simT + DTS <= target + 1e-6) stepLetters();
      render(shot, lt);
    },
  };
}

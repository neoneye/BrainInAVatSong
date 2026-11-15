// water.js: LOVE TEXTS EXPOSED TO WATER. Big chorus words painted in blood red on near-black paper; drops of vat
// fluid land on them on the beat, re-wet the pigment, push it outward, fray the edges and dry with dark rims.
// A port of assets/watercolor-text (a GPU version of Curtis et al., "Computer-Generated Watercolor", 1997):
// five fragment shaders ping-ponging two RGBA32F textures in the scene's own WebGL2 canvas (approach C).
//
// shot parameters:
//   text   words to paint, lines separated by "\n" (1–3 lines, auto-fit to ~85 % of the frame width)
//   mode   'paint' (default): beat drops, progressively wetter and more destroyed
//          'flood': the same, and a sheet of water rises from the bottom over the shot; the text washes out and runs
//          'drip':  few slow drops that slide down the letters; pigment trails downward under gravity
//   color  'red' (default; dark blood red on near-black navy) | 'green' (sickly vat green on near-black)
//   seed   drop positions and sizes
//   font   'serif' (default; Playfair Display 700, condensed) | 'mono' (IBM Plex Mono 700, condensed)
//   floodDur  (flood only) seconds until the water has covered the frame; default: the shot length (at most 20 s)
import { BEAT, BEAT0 } from '../audio.js';
import { onsetAt } from '../engine.js';

export const meta = {
  modes: ['paint', 'flood', 'drip'],
  params: { text: 'lines separated by \\n', color: ['red', 'green'], seed: 'number', font: ['serif', 'mono'], floodDur: 'seconds (flood)' },
};

const SW = 960, SH = 540;          // simulation grid (cells; y grows upward as in the GPU textures)
const DT = 1 / 60, SUB = 4, PAPER_ITERS = 3;
const LEAD = 0.035;                // drops land one frame early so the splash is on screen on the beat

// ---------- paper and helpers (from the asset's WaterCore)
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
function valueNoise(W, H, cell, rand) {
  const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2, g = new Float32Array(gw * gh), out = new Float32Array(W * H);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  for (let y = 0; y < H; y++) {
    const fy = y / cell, j = Math.floor(fy), ty = fy - j, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < W; x++) {
      const fx = x / cell, i = Math.floor(fx), tx = fx - i, sx = tx * tx * (3 - 2 * tx), o = j * gw + i;
      const a = g[o] + (g[o + 1] - g[o]) * sx, b = g[o + gw] + (g[o + gw + 1] - g[o + gw]) * sx;
      out[y * W + x] = a + (b - a) * sy;
    }
  }
  return out;
}
function fbm(W, H, cells, rand) {
  const out = new Float32Array(W * H);
  let amp = 1, tot = 0;
  for (const c of cells) {
    const n = valueNoise(W, H, c, rand);
    for (let i = 0; i < out.length; i++) out[i] += amp * n[i];
    tot += amp; amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
// cold-pressed paper: R = surface height (grain), G = how well water wicks along fibres, B = how much water it holds
function makePaper(W, H, seed = 1) {
  const rand = rng(seed);
  const grain = fbm(W, H, [2, 4, 9, 23], rand), hold = fbm(W, H, [6, 17, 41], rand), wick = fbm(W, H, [3, 11, 30], rand);
  const fib = new Float32Array(W * H);
  const n = Math.round(W * H / 55);
  for (let k = 0; k < n; k++) {
    let x = rand() * W, y = rand() * H, a = rand() * Math.PI, len = 5 + 28 * rand() * rand();
    const bend = (rand() - 0.5) * 0.12, w = 0.25 + 0.35 * rand();
    for (let s = 0; s < len; s++) {
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) fib[yi * W + xi] += w;
      x += Math.cos(a); y += Math.sin(a); a += bend;
    }
  }
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const g = Math.min(1, 0.18 + 0.55 * Math.pow(wick[i], 1.6) + 0.55 * fib[i]);
    out[i * 4] = Math.round(255 * Math.min(1, Math.max(0, (grain[i] - 0.5) * 1.8 + 0.5)));
    out[i * 4 + 1] = Math.round(255 * g);
    out[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, (hold[i] - 0.5) * 1.6 + 0.5)));
    out[i * 4 + 3] = 255;
  }
  return out;
}
function inkPoints(mask, W, H, step = 3) {
  const pts = [];
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (mask[y * W + x] > 128) pts.push([x, y]);
  return pts;
}
function edgePoints(mask, W, H, step = 3, reach = 6) {
  const pts = [], at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] > 128;
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    if (!at(x, y)) continue;
    if (!at(x - reach, y) || !at(x + reach, y) || !at(x, y - reach) || !at(x, y + reach)) pts.push([x, y]);
  }
  return pts;
}
const hash32 = (a, b) => { let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA6B)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12; return h >>> 0; };

// ---------- shaders (the asset's, plus a body force, a flood pass and a richer final image)
const VS = `#version 300 es
in vec2 aP; void main() { gl_Position = vec4(aP, 0., 1.); }`;
const HEAD = `#version 300 es
precision highp float;
uniform sampler2D uA, uB, uP;
uniform ivec2 uN;
uniform float uDt;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
const float EPS = 2e-4;
vec4 A(ivec2 c) { return texelFetch(uA, clamp(c, ivec2(0), uN - 1), 0); }
vec4 B(ivec2 c) { return texelFetch(uB, clamp(c, ivec2(0), uN - 1), 0); }
vec4 P(ivec2 c) { return texelFetch(uP, clamp(c, ivec2(0), uN - 1), 0); }
const ivec2 XL = ivec2(-1, 0), XR = ivec2(1, 0), YD = ivec2(0, -1), YU = ivec2(0, 1);
`;
// state: A = (water depth h, velocity u, v, water held in the paper s); B = (pigment floating g, pigment settled d, -, -)
const FS_INIT = HEAD + `
uniform sampler2D uM; uniform float uInk;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float m = texelFetch(uM, c, 0).r;
  oA = vec4(0.);
  oB = vec4(0., m * uInk * (0.92 + 0.16 * P(c).r), 0., 0.);
}`;
const FS_DROP = HEAD + `
uniform vec4 uD[16]; uniform vec4 uE[16]; uniform int uND;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c), b = B(c);
  for (int i = 0; i < 16; i++) {
    if (i >= uND) break;
    vec2 q = vec2(c) - uD[i].xy; float L = length(q), ang = atan(q.y, q.x), sd = uE[i].w;
    float rr = uD[i].z * (1. + .18 * sin(3. * ang + sd) + .1 * sin(7. * ang + 2. * sd) + .06 * sin(13. * ang + 5. * sd));
    float k = 1. - smoothstep(rr * .55, rr, L);
    if (k <= 0.) continue;
    a.x += uD[i].w * k;
    a.yz += k * (uE[i].x * (L > .5 ? q / L : vec2(0.)) * (L / max(rr, 1.)) * 60. + uE[i].yz);
  }
  oA = a; oB = b;
}`;
// flood: everything below a wavy front is kept under a sheet of water
const FS_FLOOD = HEAD + `
uniform float uLevel, uTime, uDepth;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c);
  float x = float(c.x), y = float(c.y);
  float front = uLevel + 13. * sin(x * .0131 + uTime * .7) + 7. * sin(x * .037 - uTime * 1.3) + 4. * sin(x * .11 + uTime * 2.1) + 26. * (P(c / 3).g - .4);
  float k = smoothstep(front, front - 26., y);
  float rip = 1. + .22 * sin(x * .045 + y * .06 + uTime * 2.3) * sin(x * .021 - y * .05 - uTime * 1.6) + .12 * sin(y * .15 - uTime * 3.1 + x * .02);
  float target = uDepth * k * rip;
  if (k > 0.) { a.x = mix(a.x, target, a.x < target ? .3 : .03); a.z += .5 * k * step(a.x, target); }   // slow swells keep the sheet moving
  oA = a; oB = B(c);
}`;
const FS_FLOW = HEAD + `
uniform float uGrav, uDrag, uRough, uEdge, uVisc; uniform vec2 uBody;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c), al = A(c + XL), ar = A(c + XR), ad = A(c + YD), au = A(c + YU);
  float h = a.x;
  float pl = al.x + uRough * P(c + XL).r, pr = ar.x + uRough * P(c + XR).r, pd = ad.x + uRough * P(c + YD).r, pu = au.x + uRough * P(c + YU).r;
  vec2 grad = .5 * vec2(pr - pl, pu - pd);
  vec2 gm = .5 * vec2(step(EPS, ar.x) - step(EPS, al.x), step(EPS, au.x) - step(EPS, ad.x));
  vec2 vel = mix(a.yz, .25 * (al.yz + ar.yz + ad.yz + au.yz), uVisc);
  vel += uDt * (-uGrav * grad - uEdge * gm + uBody * smoothstep(0., .04, h) * (.55 + .9 * P(c).g));
  vel *= exp(-uDrag * uDt);
  if (h < EPS) vel = vec2(0.);
  float sp = length(vel) * uDt; if (sp > .24) vel *= .24 / sp;
  oA = vec4(h, vel, a.w); oB = B(c);
}`;
const FS_ADVECT = HEAD + `
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c), al = A(c + XL), ar = A(c + XR), ad = A(c + YD), au = A(c + YU);
  vec4 b = B(c), bl = B(c + XL), br = B(c + XR), bd = B(c + YD), bu = B(c + YU);
  float uR = .5 * (a.y + ar.y) * uDt, uL = .5 * (al.y + a.y) * uDt, vU = .5 * (a.z + au.z) * uDt, vD = .5 * (ad.z + a.z) * uDt;
  vec2 fR = uR * (uR > 0. ? vec2(a.x, b.x) : vec2(ar.x, br.x));
  vec2 fL = uL * (uL > 0. ? vec2(al.x, bl.x) : vec2(a.x, b.x));
  vec2 fU = vU * (vU > 0. ? vec2(a.x, b.x) : vec2(au.x, bu.x));
  vec2 fD = vD * (vD > 0. ? vec2(ad.x, bd.x) : vec2(a.x, b.x));
  vec2 d = fL - fR + fD - fU;
  oA = vec4(max(0., a.x + d.x), a.yz, a.w);
  oB = vec4(max(0., b.x + d.y), b.yzw);
}`;
const FS_PAPER = HEAD + `
uniform float uAbs, uCap, uThr, uCarry, uLift, uDep, uEvap, uEvapS, uEdgeEvap, uFibre;
float K(vec4 p) { return mix(.6, .15 + 1.35 * p.g, uFibre); }
float T(vec4 p) { return uThr * mix(1., .25 + 2.2 * (1. - p.g) * (.5 + p.b), uFibre); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = A(c), b = B(c), p = P(c);
  float h = a.x, s = a.w, g = b.x, d = b.y;
  float cap = .25 + .75 * p.b;
  float ab = min(h, uAbs * uDt * max(0., cap - s)); h -= ab; s += ab;
  float conc = g / (h + s + 1e-3);
  float ds = 0., dg = 0., wetN = 0.;
  ivec2 o[4] = ivec2[4](XL, XR, YD, YU);
  float k0 = K(p), t0 = T(p);
  for (int i = 0; i < 4; i++) {
    vec4 an = A(c + o[i]), bn = B(c + o[i]), pn = P(c + o[i]);
    float kf = min(k0, K(pn)), th = max(t0, T(pn));
    float q = uCap * uDt * kf * smoothstep(th, th + .06, max(s, an.w)) * (an.w - s);
    ds += q;
    float cn = bn.x / (an.x + an.w + 1e-3);
    dg += uCarry * (q > 0. ? q * cn : q * conc);
    wetN += step(EPS, an.x);
  }
  s = max(0., s + ds); g = max(0., g + dg);
  float wet = clamp(h * 40. + s * 1.6, 0., 1.);
  float lift = uLift * uDt * wet * d * (1.1 - .5 * p.r);
  float thin = 1. - smoothstep(0., .025, h);
  float dep = uDep * uDt * g * (.15 + 2.5 * thin * (1. - .6 * smoothstep(.1, .5, s))) * (1.15 - .3 * p.r);
  d = max(0., d + dep - lift); g = max(0., g + lift - dep);
  float edge = clamp(step(EPS, h) * (1. - wetN * .25) * 2., 0., 1.);
  h = max(0., h - uDt * uEvap * (1. + uEdgeEvap * edge));
  if (h < EPS) { h = 0.; s = max(0., s - uDt * uEvapS * (.4 + p.b)); }
  if (h == 0. && s < .03) { d += g; g = 0.; }
  oA = vec4(h, h == 0. ? vec2(0.) : a.yz, s);
  oB = vec4(g, d, b.zw);
}`;
// what you see: pigment over the ground with dark rims where it piled up, damp paper darker, the water as a lens
// with a glint and a faint vat-green sheen, fine paper tooth, a low raking light and a vignette
const FS_SHOW = `#version 300 es
precision highp float;
uniform sampler2D uA, uB, uP; uniform ivec2 uN; uniform vec2 uView; uniform vec3 uPig, uPigHi, uBg, uSheen;
uniform float uRefr, uZoom, uPulse, uTime;
out vec4 o;
vec4 bil(sampler2D t, vec2 g) {
  g = clamp(g, vec2(0.), vec2(uN) - 1.001); ivec2 i = ivec2(floor(g)); vec2 f = g - vec2(i);
  vec4 a = texelFetch(t, i, 0), b = texelFetch(t, i + ivec2(1, 0), 0), c = texelFetch(t, i + ivec2(0, 1), 0), d = texelFetch(t, i + ivec2(1, 1), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 uv = gl_FragCoord.xy / uView;
  vec2 zc = vec2(.5, .6);
  vec2 g = (zc + (uv - zc) / uZoom) * vec2(uN) - .5;
  vec4 a = bil(uA, g);
  float hx = bil(uA, g + vec2(1.5, 0.)).x - bil(uA, g - vec2(1.5, 0.)).x, hy = bil(uA, g + vec2(0., 1.5)).x - bil(uA, g - vec2(0., 1.5)).x;
  vec2 off = -vec2(hx, hy) * uRefr;
  vec4 b = bil(uB, g + off);
  vec4 pp = bil(uP, g + off);
  float paper = pp.r, fib = bil(uP, g).g;
  // paper relief under a low light from the upper left
  float px = bil(uP, g + off + vec2(1., 0.)).r - bil(uP, g + off - vec2(1., 0.)).r, py = bil(uP, g + off + vec2(0., 1.)).r - bil(uP, g + off - vec2(0., 1.)).r;
  float relief = clamp(.5 + 1.6 * (-px * .6 + py * .8), 0., 1.);
  float tooth = hash(floor(gl_FragCoord.xy)) - .5;
  float pig = b.y + .8 * b.x;
  float dens = 1. - exp(-2.8 * pig);
  vec3 bg = lin(uBg) * (.62 + .34 * paper + .36 * relief + .16 * fib + .10 * tooth);
  // thin washes are a brighter, more saturated stain; piled-up pigment goes dark (the rim)
  vec3 pc = mix(lin(uPigHi), lin(uPig), smoothstep(.05, .75, pig));
  pc *= (1. - .62 * smoothstep(1.05, 2.3, pig)) * (.74 + .22 * paper + .3 * relief + .08 * tooth);
  vec3 col = mix(bg, pc, dens);
  float film = clamp(a.x * 22., 0., 1.), damp = clamp(a.w * .9, 0., 1.);
  col *= 1. - .22 * max(film, damp * .9);
  // the water: a broad sheen, a rim of light where the meniscus is steep, and a glint
  vec3 n = normalize(vec3(-hx * 9., -hy * 9., 1.));
  vec3 L = normalize(vec3(-.45, .65, .62)), hv = normalize(L + vec3(0., 0., 1.));
  float cover = clamp(a.x * 9., 0., 1.);
  float slope = clamp(length(vec2(hx, hy)) * 9., 0., 1.);
  float light = 1. + .35 * uPulse;
  col += uSheen * cover * (.02 + .05 * max(0., n.y * .7 - n.x * .5) + .10 * slope * max(0., dot(n.xy, vec2(-.6, .8)) + .35)) * light;
  col += cover * vec3(.9, 1., .92) * (pow(max(dot(n, hv), 0.), 90.) * .55 + pow(max(dot(n, hv), 0.), 14.) * .035) * light;
  // vignette, heavier at the bottom where the subtitles sit
  vec2 q = uv - vec2(.5, .54);
  col *= mix(1., .32, smoothstep(.28, .82, length(q * vec2(1.05, 1.25))));
  col *= 1. + .05 * uPulse;
  o = vec4(pow(max(col, 0.), vec3(1. / 2.2)), 1.);
}`;

const PALETTES = {
  red: { pig: [0.74, 0.075, 0.04], hi: [0.93, 0.15, 0.07], bg: [0.07, 0.115, 0.18], sheen: [0.55, 1.0, 0.8] },
  green: { pig: [0.44, 0.62, 0.10], hi: [0.66, 0.88, 0.2], bg: [0.03, 0.06, 0.05], sheen: [0.8, 1.0, 0.55] },
};
const FONTS = { serif: ['"Playfair Display"', '700', 0.85, 0.012], mono: ['"IBM Plex Mono"', '700', 0.75, 0.03] };

export async function create(ctx) {
  const OW = ctx.width || 1920, OH = ctx.height || 1080;
  const canvas = document.createElement('canvas'); canvas.width = OW; canvas.height = OH;
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('water: WebGL 2 with float render targets is required');

  // ---------- GL plumbing
  const shader = (src, type) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('water: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const program = fs => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(VS, gl.VERTEX_SHADER)); gl.attachShader(p, shader(fs, gl.FRAGMENT_SHADER));
    gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('water: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  };
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = (w, h, internal, format, type, data) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    return t;
  };
  const A = [0, 1].map(() => tex(SW, SH, gl.RGBA32F, gl.RGBA, gl.FLOAT, null));
  const Bt = [0, 1].map(() => tex(SW, SH, gl.RGBA32F, gl.RGBA, gl.FLOAT, null));
  const fbo = [0, 1].map(i => {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, A[i], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, Bt[i], 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('water: float framebuffer incomplete');
    return f;
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let cur = 0;
  const paperTex = tex(SW, SH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, makePaper(SW, SH, 11));
  const maskTex = tex(SW, SH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(SW * SH));
  const pInit = program(FS_INIT), pDrop = program(FS_DROP), pFlood = program(FS_FLOOD), pFlow = program(FS_FLOW), pAdvect = program(FS_ADVECT), pPaper = program(FS_PAPER), pShow = program(FS_SHOW);

  function pass(P, uniforms) {
    gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1 - cur]);
    gl.viewport(0, 0, SW, SH);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A[cur]); gl.uniform1i(P.u.uA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, Bt[cur]); gl.uniform1i(P.u.uB, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(P.u.uP, 2);
    if (P.u.uM) { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(P.u.uM, 3); }
    gl.uniform2i(P.u.uN, SW, SH);
    for (const k in uniforms) {
      const loc = P.u[k], v = uniforms[k]; if (!loc) continue;
      if (v instanceof Float32Array) gl.uniform4fv(loc, v);
      else if (Array.isArray(v)) gl.uniform2fv(loc, v);
      else if (k === 'uND') gl.uniform1i(loc, v);
      else gl.uniform1f(loc, v);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = 1 - cur;
  }

  // ---------- the lettering: each line is fitted to the same width (poster style), stacked, centred above the subtitles
  const maskCv = document.createElement('canvas'); maskCv.width = SW; maskCv.height = SH;
  const maskBytes = new Uint8Array(SW * SH);
  const masks = new Map();   // text|font → { ink, edge, box }
  function drawMask(text, fontKey) {
    const x = maskCv.getContext('2d', { willReadFrequently: true }), [fam, wt, squash, fat] = FONTS[fontKey] || FONTS.serif;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, SW, SH);
    let lines = String(text ?? '').toUpperCase().split('\n').map(s => s.trim()).filter(Boolean).slice(0, 3);
    if (!lines.length) lines = [' '];
    const R = 200, fitW = SW * 0.85;
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    const m = lines.map(l => {
      x.font = `${wt} ${R}px ${fam}`;
      const mt = x.measureText(l), w = Math.max(1, (mt.actualBoundingBoxLeft + mt.actualBoundingBoxRight) * squash);
      return { l, size: R * fitW / w, asc: mt.actualBoundingBoxAscent / R, desc: Math.max(0, mt.actualBoundingBoxDescent) / R, cx: (mt.actualBoundingBoxRight - mt.actualBoundingBoxLeft) / 2 / R };
    });
    // lines are fitted to the same width (capped), then the block is condensed until it also fills the height
    const smallest = Math.min(...m.map(v => v.size));
    for (const v of m) v.size = Math.min(v.size, smallest * 1.7);
    const gap = 0.15 * smallest;
    const inkH = m.reduce((s, v) => s + v.size * v.asc, 0), maxH = SH * (m.length === 1 ? 0.56 : 0.64) - gap * (m.length - 1);
    let sq = squash, k = maxH / inkH;
    if (k > 1) { const c = Math.min(k, squash / 0.5); sq = squash / c; k = c; }   // room left: narrower, taller letters
    for (const v of m) v.size *= k;
    const tot = inkH * k + gap * (m.length - 1);
    let y = SH * (m.length === 1 ? 0.41 : 0.39) - tot / 2;
    x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineJoin = 'round';
    for (const v of m) {
      y += v.size * v.asc;
      x.save(); x.translate(SW / 2, y); x.scale(sq, 1);
      x.font = `${wt} ${v.size}px ${fam}`; x.lineWidth = v.size * fat;
      x.fillText(v.l, -v.cx * v.size, 0); if (fat > 0) x.strokeText(v.l, -v.cx * v.size, 0);
      x.restore();
      y += gap;
    }
    const img = x.getImageData(0, 0, SW, SH).data;
    for (let yy = 0; yy < SH; yy++) for (let xx = 0; xx < SW; xx++) maskBytes[(SH - 1 - yy) * SW + xx] = img[(yy * SW + xx) * 4 + 3];
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SW, SH, gl.RED, gl.UNSIGNED_BYTE, maskBytes);
    const key = fontKey + '|' + text;
    let info = masks.get(key);
    if (!info) {
      const ink = inkPoints(maskBytes, SW, SH, 3), edge = edgePoints(maskBytes, SW, SH, 3, 8);
      let x0 = SW, y0 = SH, x1 = 0, y1 = 0;
      for (const [px, py] of ink) { if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
      if (!ink.length) { x0 = SW * 0.1; x1 = SW * 0.9; y0 = SH * 0.3; y1 = SH * 0.8; }
      info = { ink, edge, box: { x0, y0, x1, y1 } };
      masks.set(key, info);
    }
    return info;
  }

  // ---------- the drop schedule: a pure function of the beat index, the seed and the lettering
  // events: { t (shot-local), x, y, r, amt, splash, vx, vy, dur, sd }
  function beatEvents(k, S) {
    const tb = BEAT0 + k * BEAT, te = tb - S.t0 - LEAD, rand = rng(hash32(S.seed * 7919 + 17, k)), ev = [];
    const { ink, edge, box } = S.mask, hgt = Math.min(300, Math.max(150, box.y1 - box.y0));
    const pick = () => ink.length ? ink[Math.floor(rand() * ink.length)] : [box.x0 + rand() * (box.x1 - box.x0), box.y0 + rand() * (box.y1 - box.y0)];
    const pickEdge = () => edge.length ? edge[Math.floor(rand() * edge.length)] : pick();
    const on = Math.min(1.5, Math.max(onsetAt(tb - 0.033), onsetAt(tb), onsetAt(tb + 0.033)));
    const accent = ((k % 4) + 4) % 4 === 0, bar2 = ((k % 8) + 8) % 8 === 0;
    const lt = Math.max(0, te), ramp = Math.min(1, lt / 7);      // drops grow as the shot goes on
    if (S.mode === 'drip') {
      // one slow drop every other beat lands on the upper part of a letter and slides down it, feeding water as it goes
      if (((k % 2) + 2) % 2 !== 0) return ev;
      let best = pick();
      for (let i = 0; i < 3; i++) { const p = pick(); if (p[1] > best[1]) best = p; }
      const r = hgt * (0.045 + 0.03 * rand()) * (accent ? 1.25 : 1), sp = hgt * (0.16 + 0.14 * rand());
      ev.push({ t: te, x: best[0], y: best[1] + r * 0.4, r: r * 1.5, amt: 0.9 + 0.5 * rand(), splash: 0.35, vx: 0, vy: 0, dur: 0, sd: rand() * 6.28 });
      ev.push({ t: te + 0.05, x: best[0], y: best[1], r, amt: 0.5, splash: 0, vx: (rand() - 0.5) * sp * 0.25, vy: -sp, dur: 2.6 + 2.2 * rand(), sd: rand() * 6.28 });
      return ev;
    }
    // the beat drop: big on the bar's downbeat and on loud hits
    const big = (accent ? 1.75 : 1) * (0.8 + 0.45 * on) * (0.95 + 0.35 * ramp);
    const [x, y] = rand() < 0.55 ? pickEdge() : pick();
    const r = hgt * (0.11 + 0.10 * rand() * rand()) * big;
    ev.push({ t: te, x: x + (rand() - 0.5) * r * 0.6, y: y + (rand() - 0.5) * r * 0.6, r, amt: (0.9 + 0.8 * rand()) * (accent ? 1.3 : 1), splash: 0.7 + 0.8 * rand() + 0.5 * on, vx: 0, vy: 0, dur: 0, sd: rand() * 6.28 });
    // two small ones on the letters' outlines, where water frays the paint most visibly
    for (let i = 0; i < 2; i++) {
      const [ex, ey] = pickEdge();
      ev.push({ t: te + (0.2 + 0.6 * rand()) * BEAT, x: ex, y: ey, r: hgt * (0.035 + 0.04 * rand()), amt: 0.7 + 0.6 * rand(), splash: 0.8 + 0.6 * rand(), vx: 0, vy: 0, dur: 0, sd: rand() * 6.28 });
    }
    if (accent) {
      // satellites thrown out by the big drop
      const n = 4 + Math.floor(4 * rand());
      for (let i = 0; i < n; i++) {
        const a = rand() * 6.28, d = r * (1.3 + 1.6 * rand());
        ev.push({ t: te + 0.03 + 0.05 * rand(), x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8, r: hgt * (0.018 + 0.03 * rand()), amt: 0.5 + 0.4 * rand(), splash: 1.1, vx: 0, vy: 0, dur: 0, sd: rand() * 6.28 });
      }
    }
    // an off-beat drop when the drums hit between beats
    const tOff = tb + BEAT / 2, onOff = Math.max(onsetAt(tOff - 0.033), onsetAt(tOff), onsetAt(tOff + 0.033));
    const rOff = rand(), pOff = rand() < 0.6 ? pickEdge() : pick();
    if (onOff > 0.55) ev.push({ t: te + BEAT / 2, x: pOff[0], y: pOff[1], r: hgt * (0.07 + 0.05 * rOff) * (0.8 + 0.3 * Math.min(1.5, onOff)), amt: 0.8 + 0.5 * rOff, splash: 0.9, vx: 0, vy: 0, dur: 0, sd: rOff * 6.28 });
    // every other bar a run slides down through a letter and drags the paint with it
    if (bar2 || (accent && rand() < 0.35)) {
      const [rx, ry] = pick(), sp = hgt * (0.3 + 0.3 * rand());
      ev.push({ t: te + BEAT * (1 + Math.floor(rand() * 2)), x: rx, y: Math.min(box.y1, ry + hgt * 0.15), r: hgt * (0.035 + 0.03 * rand()), amt: 0.9, splash: 0, vx: (rand() - 0.5) * sp * 0.5, vy: -sp, dur: 1.0 + 0.9 * rand(), sd: rand() * 6.28 });
    }
    return ev;
  }

  // ---------- simulation
  const S = { key: null, steps: 0, t0: 0, seed: 1, mode: 'paint', mask: null, nextBeat: 0, queue: [], active: [], pending: [], floodDur: 12 };
  function reset(shot, key, mode) {
    S.key = key; S.steps = 0; S.t0 = shot.t0 || 0; S.seed = (shot.seed ?? 1) | 0; S.mode = mode;
    S.mask = drawMask(shot.text ?? 'TOUCH ME', shot.font);
    pass(pInit, { uInk: 1.0 }); pass(pInit, { uInk: 1.0 });
    S.queue = []; S.active = []; S.pending = [];
    S.nextBeat = Math.ceil((S.t0 + LEAD - BEAT0) / BEAT - 1e-6);
    const dur = shot.dur > 0 && shot.dur < 60 ? shot.dur : 12;
    S.floodDur = shot.floodDur > 0 ? shot.floodDur : Math.min(20, dur);
  }
  function flushDrops() {
    const pd = S.pending;
    for (let o = 0; o < pd.length; o += 16) {
      const n = Math.min(16, pd.length - o), D = new Float32Array(64), E = new Float32Array(64);
      for (let i = 0; i < n; i++) { const d = pd[o + i]; D.set([d[0], d[1], d[2], d[3]], i * 4); E.set([d[4], d[5], d[6], d[7]], i * 4); }
      pass(pDrop, { uD: D, uE: E, uND: n, uDt: 0 });
    }
    pd.length = 0;
  }
  function step() {
    S.steps++;
    const simT = S.steps * DT, mode = S.mode;
    while (BEAT0 + S.nextBeat * BEAT - S.t0 - LEAD <= simT) { for (const e of beatEvents(S.nextBeat, S)) S.queue.push(e); S.nextBeat++; }
    if (S.queue.length) {
      const keep = [];
      for (const e of S.queue) {
        if (e.t > simT) { keep.push(e); continue; }
        if (e.dur > 0) S.active.push({ ...e, left: e.dur });
        else S.pending.push([e.x, e.y, e.r, e.amt, e.splash, 0, 0, e.sd]);
      }
      S.queue = keep;
    }
    for (const e of S.active) {   // a drop that slides: it keeps feeding a little water along its path
      e.x += e.vx * DT; e.y += e.vy * DT; e.left -= DT;
      S.pending.push([e.x, e.y, e.r, e.amt * DT * 6, 0, e.vx * 0.8, e.vy * 0.8, e.sd]);
    }
    if (S.active.length) S.active = S.active.filter(e => e.left > 0);
    flushDrops();
    const d = DT / SUB;
    const flow = { uGrav: 1500, uDrag: 2.2, uRough: 0.012, uEdge: 12, uVisc: 0.15, uBody: [0, 0], uDt: d };
    const paper = { uAbs: 2, uCap: 38, uThr: 0.3, uCarry: 0.35, uLift: 0.65, uDep: 0.4, uEvap: 0.025, uEvapS: 0.03, uEdgeEvap: 1.5, uFibre: 0.85, uDt: d };
    if (mode === 'drip') { flow.uBody = [0, -95]; paper.uLift = 0.8; paper.uEvap = 0.02; paper.uCarry = 0.45; }
    else if (mode === 'flood') {
      const p = Math.min(1, simT / S.floodDur), e = p * p * (3 - 2 * p);
      flow.uBody = [0, -40 - 120 * e]; paper.uLift = 0.65 + 2.2 * e; paper.uDep = 0.4 - 0.3 * e;
      pass(pFlood, { uLevel: -40 + (SH + 90) * Math.pow(Math.min(1, p / 0.8), 0.85), uTime: simT, uDepth: 0.16 + 0.1 * e, uDt: DT });
    } else { flow.uBody = [0, -10]; }
    for (let s = 0; s < SUB; s++) {
      pass(pFlow, flow);
      pass(pAdvect, { uDt: d });
      for (let k = 0; k < PAPER_ITERS; k++) pass(pPaper, paper);
    }
  }
  function show(t, shot) {
    const pal = PALETTES[shot.color] || PALETTES.red, lt = Math.max(0, shot.lt || 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, OW, OH);
    gl.useProgram(pShow.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A[cur]); gl.uniform1i(pShow.u.uA, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, Bt[cur]); gl.uniform1i(pShow.u.uB, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(pShow.u.uP, 2);
    gl.uniform2i(pShow.u.uN, SW, SH); gl.uniform2f(pShow.u.uView, OW, OH);
    gl.uniform3fv(pShow.u.uPig, pal.pig); gl.uniform3fv(pShow.u.uPigHi, pal.hi); gl.uniform3fv(pShow.u.uBg, pal.bg); gl.uniform3fv(pShow.u.uSheen, pal.sheen);
    gl.uniform1f(pShow.u.uRefr, 40);
    gl.uniform1f(pShow.u.uZoom, 1 + 0.045 * (1 - Math.exp(-lt / 9)));          // a slow push in
    gl.uniform1f(pShow.u.uPulse, shot.beat ? shot.beat.pulse : 0);
    gl.uniform1f(pShow.u.uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();   // the engine uploads this canvas right after update()
  }

  return {
    canvas,
    update(t, shot) {
      const mode = meta.modes.includes(shot.mode) ? shot.mode : 'paint';
      const key = [shot.t0, shot.text, mode, shot.seed, shot.font, shot.floodDur, mode === 'flood' ? shot.dur : 0].join('|');
      const n = Math.max(0, Math.floor((shot.lt || 0) / DT + 1e-4));
      if (key !== S.key || n < S.steps) reset(shot, key, mode);
      while (S.steps < n) step();
      show(t, shot);
    },
  };
}

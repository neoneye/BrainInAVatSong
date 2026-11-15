// parts.js: building blocks of the lab scene: noise, brain geometry and material, dynamic tubes (wires, eye stalks,
// tails), the instanced eyeballs, and the glass / fluid / bubble shaders.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const hash2 = (a, b) => hash(a * 17.31 + b * 71.77 + 0.123);
export function rngOf(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// a random value per time slot that jumps quickly at the slot boundary and then holds (saccades, glances)
export const hold = (t, period, seed, snap = 0.09) => { const x = t / period, i = Math.floor(x), f = x - i; return lerp(hash2(i - 1, seed), hash2(i, seed), sstep(0, snap / period, f)); };
// 0/1 indicator per slot (1 with probability prob), with the same quick transition
export const glance = (t, period, seed, prob, snap = 0.1) => { const x = t / period, i = Math.floor(x), f = x - i; return lerp(hash2(i - 1, seed) < prob ? 1 : 0, hash2(i, seed) < prob ? 1 : 0, sstep(0, snap / period, f)); };

export function makeNoise(seed) {
  const perm = new Uint8Array(512), r = rngOf(seed * 7919), p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = r() * (i + 1) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y, z) => { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  return (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi, B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  };
}

// ───────────────────────── shared GLSL ─────────────────────────
export const LIT = `
uniform vec3 uKeyDir; uniform vec3 uKeyCol; uniform vec3 uAmb; uniform float uFogD; uniform float uTime;
float fogF(float d) { float f = d * uFogD; return exp(-f * f); }
vec3 labLit(vec3 N, vec3 V, vec3 alb, vec3 under, float gloss, float sk) {
  float k = max(dot(N, uKeyDir), 0.0);
  vec3 c = alb * (uKeyCol * k + uAmb + under * (0.25 + 0.75 * max(-N.y, 0.0)));
  vec3 Hh = normalize(uKeyDir + V);
  c += uKeyCol * pow(max(dot(N, Hh), 0.0), gloss) * sk;
  c += (under * 0.6 + uAmb + uKeyCol * 0.06) * pow(1.0 - max(dot(N, V), 0.0), 3.0) * sk * 0.5;
  return c;
}`;
const MM = `
#ifdef USE_INSTANCING
  mat4 mm = modelMatrix * instanceMatrix;
#else
  mat4 mm = modelMatrix;
#endif`;

// ───────────────────────── brain ─────────────────────────
// Cube-sphere displaced by ridged noise (ported from assets/brain-in-a-vat). Front of the brain is +z, top is +y.
export function makeBrain(seed, N, wscale = 4.3, wdepth = 1.0) {
  const noise3 = makeNoise(seed);
  const ridge = (x, y, z) => {
    const f = wscale, a = x * f, b = y * f, c = z * f;
    const px = a + 1.1 * noise3(a * 0.5 + 7.1, b * 0.5, c * 0.5), py = b + 1.1 * noise3(a * 0.5, b * 0.5 + 3.3, c * 0.5), pz = c + 1.1 * noise3(a * 0.5, b * 0.5, c * 0.5 + 9.7);
    const n1 = Math.abs(noise3(px, py, pz)), n2 = Math.abs(noise3(px * 1.9 + 11, py * 1.9, pz * 1.9 + 5)) + 0.05;
    return Math.pow(sstep(0, 0.15, Math.min(n1, n2)), 0.6);
  };
  const SY = y => y > 0 ? 0.70 : 0.52;
  const point = (dx, dy, dz, out) => {
    const fis = Math.exp(-dx * dx / 0.004) * sstep(-0.3, 0.2, dy) * 0.14;
    const h = ridge(dx, dy, dz), k = (1 - fis) * (1 + wdepth * 0.15 * (h - 1));
    out[0] = dx * 0.80 * (1 - 0.08 * dz) * k; out[1] = dy * SY(dy) * k; out[2] = dz * k; return h;
  };
  const pos = [], hh = [], idx = [], o = [0, 0, 0];
  for (let f = 0; f < 6; f++) {
    const b0 = pos.length / 3;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const a = Math.tan((-1 + 2 * i / N) * Math.PI / 4), b = Math.tan((-1 + 2 * j / N) * Math.PI / 4);
      const v = f === 0 ? [1, a, b] : f === 1 ? [-1, b, a] : f === 2 ? [b, 1, a] : f === 3 ? [a, -1, b] : f === 4 ? [a, b, 1] : [b, a, -1];
      const l = Math.hypot(...v), h = point(v[0] / l, v[1] / l, v[2] / l, o);
      pos.push(o[0], o[1], o[2]); hh.push(h);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const p = b0 + j * (N + 1) + i; idx.push(p, p + 1, p + N + 1, p + 1, p + N + 2, p + N + 1); }
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('aH', new THREE.Float32BufferAttribute(hh, 1)); geo.setIndex(idx);
  geo = mergeVertices(geo, 1e-4); geo.computeVertexNormals();
  return { geo, point };
}
export function cerebellumGeo() {
  const cg = new THREE.SphereGeometry(1, 40, 32), cp = cg.attributes.position, h = new Float32Array(cp.count);
  for (let i = 0; i < cp.count; i++) { const y = cp.getY(i), s = Math.sin(y * 34), k = 1 + 0.04 * s; cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k); h[i] = 0.72 + 0.28 * s; }
  cg.computeVertexNormals(); cg.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  cg.scale(0.5, 0.27, 0.38); cg.translate(0, -0.36, -0.58);
  return cg;
}
// Wet flesh material: MeshPhysicalMaterial plus fold shading, glow from inside the folds, electrode ripples, sparkles,
// light from the fluid below, and (for him) stitched scars.
export function brainMaterial(G, { color, scar = false, key = '', rough = 0.5, coat = 0.55 }) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: rough, clearcoat: coat, clearcoatRoughness: 0.3, metalness: 0 });
  const u = m.userData.u = {
    uTime: G.uTime, uUnderCol: { value: new THREE.Color(0, 0, 0) }, uGlowCol: { value: new THREE.Color(1, 0.6, 0.3) }, uSparkCol: { value: new THREE.Color(0.7, 0.95, 1) },
    uInner: { value: 0 }, uTwinkle: { value: 0 }, uPads: { value: Array.from({ length: 5 }, () => new THREE.Vector3(9, 9, 9)) },
    uRing: { value: [new THREE.Vector2(9, 0), new THREE.Vector2(9, 0)] }, uRip: { value: new THREE.Vector2(0, 0) },
  };
  m.customProgramCacheKey = () => 'labbrain' + (scar ? 's' : 'n') + key;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH; varying float vH; varying vec3 vLocal; uniform vec2 uRip;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = aH; vLocal = position; transformed += normal * uRip.x * sin(dot(position, vec3(4.0, 9.0, 5.0)) - uRip.y);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vH; varying vec3 vLocal; uniform float uTime, uInner, uTwinkle; uniform vec3 uUnderCol, uGlowCol, uSparkCol; uniform vec3 uPads[5]; uniform vec2 uRing[2];
        float bhash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.22, 1.0, vH);
        float blot = 0.5 + 0.5 * sin(vLocal.x * 5.0 + sin(vLocal.z * 4.0) * 2.0 + vLocal.y * 3.0);
        diffuseColor.rgb *= 0.86 + 0.14 * blot;
        ${scar ? `
        { float fr = smoothstep(0.15, 0.35, vLocal.z), tp = smoothstep(0.05, 0.2, vLocal.y);
          float sd = abs(vLocal.y - 0.16 - 0.5 * vLocal.x + 0.04 * sin(vLocal.x * 11.0)) + (1.0 - fr) * 9.0;
          float cut = smoothstep(0.045, 0.02, sd), st = smoothstep(0.17, 0.15, sd) * step(fract(vLocal.x * 7.0 + 0.3), 0.22);
          float sd2 = abs(vLocal.z + 0.12 - 0.07 * sin(vLocal.x * 7.0)) + (1.0 - tp) * 9.0;
          float cut2 = smoothstep(0.045, 0.02, sd2), st2 = smoothstep(0.17, 0.15, sd2) * step(fract(vLocal.x * 6.0), 0.22);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.3, 0.3), max(smoothstep(0.2, 0.05, sd), smoothstep(0.2, 0.05, sd2)) * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.005, 0.01), max(cut, cut2));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008, 0.008, 0.012), max(st, st2)); }` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 wn = inverseTransformDirection(normal, viewMatrix);
          float sul = 1.0 - smoothstep(0.3, 0.95, vH);
          vec3 gl = uGlowCol * uInner * sul * sul;
          float ring = 0.0;
          for (int i = 0; i < 5; i++) { float d = distance(vLocal, uPads[i]);
            ring += uRing[0].y * exp(-pow((d - uRing[0].x) * 6.0, 2.0)) + uRing[1].y * exp(-pow((d - uRing[1].x) * 6.0, 2.0));
            ring += uInner * 0.5 * exp(-d * d * 60.0); }
          gl += uSparkCol * ring * (0.1 + 0.9 * sul) * 0.5;
          vec3 tc = vLocal * 15.0; float tw = step(1.0 - 0.03 * uTwinkle, bhash(floor(tc) + floor(uTime * 12.0))) * smoothstep(0.42, 0.05, length(fract(tc) - 0.5));
          gl += uSparkCol * tw * (0.3 + sul) * 2.0;
          float und = (0.22 + 0.78 * max(-wn.y, 0.0)) * smoothstep(0.75, -0.55, vLocal.y);
          gl += diffuseColor.rgb * uUnderCol * und;
          totalEmissiveRadiance += gl; }`);
  };
  return m;
}

// ───────────────────────── dynamic tubes ─────────────────────────
// n tubes of `segs` segments in one geometry; positions are rewritten on the CPU every frame.
export class TubeSet {
  constructor(n, segs, radial, material) {
    this.n = n; this.segs = segs; this.radial = radial;
    const rings = segs + 1, vpt = rings * (radial + 1);
    this.pos = new Float32Array(n * vpt * 3); this.nor = new Float32Array(n * vpt * 3);
    const uv = new Float32Array(n * vpt * 2), id = new Float32Array(n * vpt), idx = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < rings; k++) for (let j = 0; j <= radial; j++) {
      const q = i * vpt + k * (radial + 1) + j; uv[q * 2] = k / segs; uv[q * 2 + 1] = j / radial; id[q] = i;
      if (k < segs && j < radial) { const b = q + radial + 1; idx.push(q, b, q + 1, b, b + 1, q + 1); }
    }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aId', new THREE.BufferAttribute(id, 1)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material); this.mesh.frustumCulled = false;
    this.pts = Array.from({ length: rings }, () => new THREE.Vector3());
  }
  // pts: rings Vector3 (defaults to this.pts); rad: number or fn(u)
  set(i, rad, pts = this.pts) {
    const R = this.radial, rings = this.segs + 1, pos = this.pos, nor = this.nor;
    let o = i * rings * (R + 1) * 3, nx = 1, ny = 0, nz = 0;
    for (let k = 0; k < rings; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(rings - 1, k + 1)], c = pts[k];
      let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (k === 0) { if (Math.abs(ty) < 0.9) { nx = -tz; ny = 0; nz = tx; } else { nx = 1; ny = 0; nz = 0; } }
      const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const r = typeof rad === 'function' ? rad(k / (rings - 1)) : rad;
      for (let j = 0; j <= R; j++) {
        const an = j / R * 6.2831853, cs = Math.cos(an), sn = Math.sin(an), ux = nx * cs + bx * sn, uy = ny * cs + by * sn, uz = nz * cs + bz * sn;
        pos[o] = c.x + ux * r; pos[o + 1] = c.y + uy * r; pos[o + 2] = c.z + uz * r; nor[o] = ux; nor[o + 1] = uy; nor[o + 2] = uz; o += 3;
      }
    }
  }
  hide(i) { for (const p of this.pts) p.set(0, -50, 0); this.set(i, 0); }
  done() { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true; }
  // fill this.pts with a Catmull-Rom curve through ctrl (array of Vector3)
  catmull(ctrl) {
    const m = ctrl.length, rings = this.segs + 1;
    for (let k = 0; k < rings; k++) {
      const x = k / (rings - 1) * (m - 1), i = Math.min(m - 2, Math.floor(x)), f = x - i;
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(m - 1, i + 2)], f2 = f * f, f3 = f2 * f;
      const c0 = -0.5 * f3 + f2 - 0.5 * f, c1 = 1.5 * f3 - 2.5 * f2 + 1, c2 = -1.5 * f3 + 2 * f2 + 0.5 * f, c3 = 0.5 * f3 - 0.5 * f2;
      this.pts[k].set(c0 * p0.x + c1 * p1.x + c2 * p2.x + c3 * p3.x, c0 * p0.y + c1 * p1.y + c2 * p2.y + c3 * p3.y, c0 * p0.z + c1 * p1.z + c2 * p2.z + c3 * p3.z);
    }
  }
}
// material for wires (travelling electrode pulses) and wet flesh cords
export function tubeMaterial(G, { base, gloss = 40, spec = 0.5 }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...G, uBase: { value: new THREE.Color(base) }, uUnder: { value: new THREE.Color(0, 0, 0) }, uGloss: { value: gloss }, uSpecK: { value: spec },
      uPulse: { value: new THREE.Vector3(-1, 0, 0) }, uPulseCol: { value: new THREE.Color(0.6, 0.9, 1) }, uEmit: { value: new THREE.Color(0, 0, 0) } },
    vertexShader: `attribute float aId; varying vec3 vN, vW; varying float vU, vId, vFog;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vU = uv.x; vId = aId; vec4 mv = viewMatrix * w; vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${LIT}
      uniform vec3 uBase, uUnder, uPulseCol, uEmit; uniform float uGloss, uSpecK; uniform vec3 uPulse; varying vec3 vN, vW; varying float vU, vId, vFog;
      void main() { vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
        vec3 c = labLit(N, V, uBase, uUnder, uGloss, uSpecK) + uEmit;
        float pl = uPulse.y * exp(-pow((vU - uPulse.x) * 7.0, 2.0)) + uPulse.z * exp(-pow((fract(vU - uTime * 1.7 - vId * 0.37) - 0.5) * 6.0, 2.0));
        c += uPulseCol * pl * (0.4 + 0.6 * max(dot(N, V), 0.0));
        gl_FragColor = vec4(c * fogF(vFog), 1.0); }`,
  });
}

// ───────────────────────── eyes ─────────────────────────
// Instanced eyeballs. Each instance sits in a "socket" frame (instance matrix, +z = resting look direction); the gaze
// direction, the two lids (angles above / below the socket axis, plus a tilt), pupil size and colours are attributes.
export class EyeSet {
  constructor(n, G) {
    this.n = n;
    const geo = new THREE.SphereGeometry(1, 36, 26);
    const at = (name, k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * k), k); geo.setAttribute(name, a); return a; };
    this.aGaze = at('aGaze', 3); this.aLid = at('aLid', 3); this.aPup = at('aPup', 1); this.aIris = at('aIris', 3); this.aFlesh = at('aFlesh', 3); this.aUnder = at('aUnder', 3);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...G },
      vertexShader: `attribute vec3 aGaze, aLid, aIris, aFlesh, aUnder; attribute float aPup;
        varying vec3 vP, vN, vW, vGaze, vIris, vFlesh, vUnder, vLid; varying float vPup, vFog;
        void main() { vec3 p = normalize(position);
          float phi = atan(p.y, p.z), up = aLid.x + aLid.z * p.x, lo = aLid.y - aLid.z * p.x * 0.6;
          float lid = max(smoothstep(up - 0.07, up + 0.05, phi) * smoothstep(2.55, 2.3, phi), smoothstep(-lo + 0.07, -lo - 0.05, phi) * smoothstep(-2.55, -2.3, phi)) * smoothstep(1.0, 0.94, abs(p.x));
          mat4 mm = modelMatrix * instanceMatrix;
          vec4 w = mm * vec4(p * (1.0 + 0.085 * lid), 1.0); vW = w.xyz; vN = normalize(mat3(mm) * p); vP = p;
          vGaze = aGaze; vIris = aIris; vFlesh = aFlesh; vUnder = aUnder; vLid = aLid; vPup = aPup;
          vec4 mv = viewMatrix * w; vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `${LIT}
        uniform float uGlint, uEyeGlow; varying vec3 vP, vN, vW, vGaze, vIris, vFlesh, vUnder, vLid; varying float vPup, vFog;
        void main() { vec3 p = normalize(vP), g = normalize(vGaze), N = normalize(vN), V = normalize(cameraPosition - vW);
          float ang = acos(clamp(dot(p, g), -1.0, 1.0));
          vec3 col = vec3(0.80, 0.75, 0.64);
          float vn = abs(sin(dot(p, vec3(7.0, 11.0, 5.0)) + 2.0 * sin(dot(p, vec3(-9.0, 4.0, 8.0)))));
          col = mix(col, vec3(0.5, 0.05, 0.04), smoothstep(0.1, 0.0, vn) * smoothstep(0.55, 1.2, ang) * 0.8);
          col = mix(col, vec3(0.5, 0.1, 0.09) * (0.8 + 0.2 * sin(atan(p.y, p.x) * 14.0)), smoothstep(0.8, 1.7, ang) * 0.85);
          float IR = 0.66, pr = mix(0.12, 0.52, vPup);
          vec3 t1 = normalize(cross(g, vec3(0.02, 1.0, 0.03))), t2 = cross(g, t1);
          float a = atan(dot(p, t2), dot(p, t1)), st = 0.5 + 0.5 * sin(a * 34.0 + 3.0 * sin(a * 5.0));
          vec3 ir = vIris * (0.4 + 0.8 * st) * mix(1.3, 0.6, smoothstep(pr, IR, ang));
          ir = mix(ir, vIris * 0.08, smoothstep(IR - 0.13, IR, ang));
          col = mix(col, ir, smoothstep(IR, IR - 0.05, ang));
          col = mix(col, vec3(0.004), smoothstep(pr, pr - 0.05, ang));
          float phi = atan(p.y, p.z), up = vLid.x + vLid.z * p.x, lo = vLid.y - vLid.z * p.x * 0.6;
          float lid = max(smoothstep(up - 0.015, up + 0.015, phi) * smoothstep(2.45, 2.4, phi), smoothstep(-lo + 0.015, -lo - 0.015, phi) * smoothstep(-2.45, -2.4, phi)) * smoothstep(0.985, 0.965, abs(p.x));
          col *= mix(0.35, 1.0, smoothstep(0.0, 0.32, up - phi)) * mix(0.6, 1.0, smoothstep(0.0, 0.2, phi + lo));
          vec3 lit = labLit(N, V, col, vUnder, 120.0, 2.2) + ir * uEyeGlow * smoothstep(IR, IR - 0.05, ang) * step(pr, ang);
          vec3 Hc = normalize(V + vec3(-0.25, 0.5, 0.15));
          lit += uGlint * vec3(0.9, 1.0, 0.95) * (pow(max(dot(N, Hc), 0.0), 260.0) * 2.5 + pow(max(dot(N, normalize(V + vec3(0.3, -0.35, 0.0))), 0.0), 500.0) * 0.8);
          float edge = min(min(abs(phi - up), abs(phi + lo)), 2.42 - abs(phi));
          vec3 fl = vFlesh * (0.9 + 0.1 * sin(phi * 17.0 + p.x * 3.0));
          fl = mix(vec3(0.3, 0.05, 0.06), fl, smoothstep(0.0, 0.12, edge));
          vec3 litLid = labLit(N, V, fl, vUnder, 26.0, 0.45);
          gl_FragColor = vec4(mix(lit, litLid, lid) * fogF(vFog), 1.0); }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n); this.mesh.frustumCulled = false;
    this._m = new THREE.Matrix4(); this._s = new THREE.Vector3();
  }
  style(i, iris, flesh) { this.aIris.setXYZ(i, iris[0], iris[1], iris[2]); this.aFlesh.setXYZ(i, flesh[0], flesh[1], flesh[2]); this.aIris.needsUpdate = this.aFlesh.needsUpdate = true; }
  set(i, pos, quat, r, gaze, lidUp, lidLo, tilt, pupil, under) {
    this._m.compose(pos, quat, this._s.set(r, r, r)); this.mesh.setMatrixAt(i, this._m);
    this.aGaze.setXYZ(i, gaze.x, gaze.y, gaze.z); this.aLid.setXYZ(i, lidUp, lidLo, tilt); this.aPup.setX(i, pupil);
    if (under) this.aUnder.setXYZ(i, under.r, under.g, under.b);
  }
  done() { this.mesh.instanceMatrix.needsUpdate = true; this.aGaze.needsUpdate = this.aLid.needsUpdate = this.aPup.needsUpdate = this.aUnder.needsUpdate = true; }
}

// ───────────────────────── glass, fluid, bubbles ─────────────────────────
export function glassMaterial(G, o = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, premultipliedAlpha: true,
    uniforms: { ...G, uTint: { value: new THREE.Color(0.8, 0.92, 0.95) }, uGlowCol: { value: new THREE.Color(0, 0, 0) }, uGlowK: o.glowK || { value: 1 }, uDust: { value: 0 } },
    vertexShader: `varying vec3 vN, vV; varying vec2 vUv; varying float vFog;
      void main() { ${MM}
        vec4 mv = viewMatrix * mm * vec4(position, 1.0); vN = normalize(mat3(viewMatrix) * mat3(mm) * normal); vV = normalize(-mv.xyz); vUv = uv; vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${LIT}
      uniform vec3 uTint, uGlowCol; uniform float uGlowK, uDust; varying vec3 vN, vV; varying vec2 vUv; varying float vFog;
      void main() { vec3 n = normalize(vN); float front = gl_FrontFacing ? 1.0 : 0.0; if (!gl_FrontFacing) n = -n;
        float rim = 1.0 - abs(dot(n, normalize(vV))), sx = n.x, vY = vUv.y;
        float hl = (smoothstep(-0.74, -0.7, sx) * smoothstep(-0.56, -0.62, sx) * 0.3 + smoothstep(-0.37, -0.34, sx) * smoothstep(-0.27, -0.3, sx) * 0.2 + smoothstep(0.6, 0.63, sx) * smoothstep(0.7, 0.67, sx) * 0.2) * front;
        hl *= smoothstep(0.02, 0.14, vY) * smoothstep(0.995, 0.9, vY);
        vec3 key = uKeyCol + uAmb * 3.0;
        float a = 0.006 + 0.5 * pow(rim, 3.0);
        vec3 c = uTint * key * a * 0.55 + key * hl * 0.5 + uGlowCol * uGlowK * pow(rim, 2.0) * (0.12 + 0.88 * pow(1.0 - vY, 2.0)) * 0.7;
        float dn = 0.5 + 0.5 * sin(vUv.x * 90.0 + sin(vUv.y * 13.0) * 4.0) * sin(vUv.y * 37.0 + sin(vUv.x * 31.0) * 2.0);
        float streak = 0.5 + 0.5 * sin(vUv.x * 160.0 + sin(vUv.x * 23.0) * 5.0);
        float du = uDust * (0.55 + 0.3 * dn + 0.25 * streak * vY) * front;
        c += du * vec3(0.3, 0.27, 0.21) * (key * 0.5 + 0.03 + uGlowCol * uGlowK * 0.2); a += du * 0.5;
        float f = fogF(vFog); gl_FragColor = vec4(c * f, a * f); }`,
  });
}
// part: 'back' (far wall of the fluid, drawn behind the brain), 'front' (haze in front of the brain) or 'surf' (top surface)
export function fluidMaterial(G, part, inst, o = {}) {
  const defs = {}; if (inst) defs.INST = 1; defs[part.toUpperCase()] = 1;
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: part === 'back' ? THREE.BackSide : part === 'front' ? THREE.FrontSide : THREE.DoubleSide, defines: defs,
    uniforms: { ...G, uCol: { value: new THREE.Color(0.5, 0.9, 0.3) }, uLevel: { value: 2.3 }, uGlow: o.glow || { value: 1 }, uY0: { value: 0.15 }, uTilt: { value: new THREE.Vector2() }, uMurk: { value: o.murk ?? 0.35 } },
    vertexShader: `
      #ifdef INST
      attribute vec3 aCol; attribute vec2 aLG;
      #endif
      uniform vec3 uCol; uniform float uLevel, uGlow, uY0; uniform vec2 uTilt;
      varying vec3 vCol, vLP; varying float vGlow, vV, vFog, vFace;
      void main() { ${MM}
        vec3 p = position; float level = uLevel, glow = uGlow; vec3 col = uCol;
        #ifdef INST
        level = aLG.x; glow = aLG.y * uGlow; col = aCol;
        #endif
        #ifdef SURF
        p.y = level + uTilt.x * p.x + uTilt.y * p.z; vV = 1.0;
        #else
        float v = p.y; p.y = uY0 + v * (level - uY0) + smoothstep(0.5, 1.0, v) * (uTilt.x * p.x + uTilt.y * p.z); vV = v;
        #endif
        vLP = p; vCol = col; vGlow = glow;
        vec4 mv = viewMatrix * mm * vec4(p, 1.0); vec3 n = normalize(mat3(viewMatrix) * mat3(mm) * normal);
        vFace = abs(dot(n, normalize(-mv.xyz))); vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${LIT}
      uniform float uMurk; varying vec3 vCol, vLP; varying float vGlow, vV, vFog, vFace;
      void main() { float iv = clamp(1.0 - vV, 0.0, 1.0); float grad = 0.006 + 0.8 * pow(iv, 4.0) + 0.04 * pow(iv, 1.5);
        float sh = 0.5 + 0.5 * sin(vLP.x * 9.0 + uTime * 0.7 + sin(vLP.z * 7.0 + uTime * 0.45) * 1.6);
        grad *= 0.8 + 0.4 * sh * iv;
        vec3 c = vCol * vGlow * grad + vCol * (uKeyCol + uAmb) * 0.012; float f = fogF(vFog);
        #if defined(SURF)
        gl_FragColor = vec4((vCol * vGlow * 0.05 + vCol * uKeyCol * 0.05) * f, 0.4);
        #elif defined(BACK)
        gl_FragColor = vec4(c * 0.85 * f, 0.85);
        #else
        float a = uMurk * (0.3 + 0.7 * vFace); gl_FragColor = vec4(c * 0.6 * a * f, a);
        #endif
      }`,
  });
}
export function bubbleMaterial(G) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...G, uCol: { value: new THREE.Color(1, 1, 1) }, uPx: { value: 2000 } },
    vertexShader: `attribute float aSize; uniform float uPx; varying float vFog;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vFog = -mv.z; gl_PointSize = aSize * uPx / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${LIT}
      uniform vec3 uCol; varying float vFog;
      void main() { vec2 d = gl_PointCoord * 2.0 - 1.0; float r = length(d); if (r > 1.0) discard;
        float ring = smoothstep(0.5, 0.92, r) * smoothstep(1.0, 0.9, r), sp = exp(-dot(d - vec2(-0.35, -0.4), d - vec2(-0.35, -0.4)) * 22.0);
        gl_FragColor = vec4((uCol * (0.1 + 0.9 * ring) + vec3(sp) * (uCol * 0.6 + uKeyCol)) * fogF(vFog), 1.0); }`,
  });
}

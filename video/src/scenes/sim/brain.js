// brain.js: procedural brain mesh (folds = zero lines of warped noise), after assets/brain-in-a-vat/index.html.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function rngOf(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const hash = (a, b = 0) => { let x = Math.sin(a * 127.1 + b * 311.7 + 1.3) * 43758.5453; return x - Math.floor(x); };

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function makeNoise(seed) {
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

// Unit-ish brain: x = left/right (fissure at x = 0), y = up, z = front/back. Vertex colour darkens the sulci.
export function brainGeo(seed, N = 40, wscale = 3.6, wdepth = 1.9) {
  const noise3 = makeNoise(seed);
  const ridge = (x, y, z) => {
    const f = wscale, a = x * f, b = y * f, c = z * f;
    const px = a + 1.1 * noise3(a * 0.5 + 7.1, b * 0.5, c * 0.5), py = b + 1.1 * noise3(a * 0.5, b * 0.5 + 3.3, c * 0.5), pz = c + 1.1 * noise3(a * 0.5, b * 0.5, c * 0.5 + 9.7);
    const n1 = Math.abs(noise3(px, py, pz)), n2 = Math.abs(noise3(px * 1.9 + 11, py * 1.9, pz * 1.9 + 5)) + 0.05;
    return Math.pow(smooth(0, 0.17, Math.min(n1, n2)), 0.6);
  };
  const pos = [], col = [], idx = [];
  for (let f = 0; f < 6; f++) {
    const b0 = pos.length / 3;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const a = Math.tan((-1 + 2 * i / N) * Math.PI / 4), b = Math.tan((-1 + 2 * j / N) * Math.PI / 4);
      const v = f === 0 ? [1, a, b] : f === 1 ? [-1, b, a] : f === 2 ? [b, 1, a] : f === 3 ? [a, -1, b] : f === 4 ? [a, b, 1] : [b, a, -1];
      const l = Math.hypot(...v), dx = v[0] / l, dy = v[1] / l, dz = v[2] / l;
      const fis = Math.exp(-dx * dx / 0.004) * smooth(-0.3, 0.2, dy) * 0.15;
      const h = ridge(dx, dy, dz), k = (1 - fis) * (1 + wdepth * 0.11 * (h - 1));
      pos.push(dx * 0.80 * (1 - 0.08 * dz) * k, dy * (dy > 0 ? 0.70 : 0.52) * k, dz * k);
      const c = 0.22 + 0.78 * h * (1 - fis * 3); col.push(c, c * c * 0.9 + 0.1 * c, c * c * 0.9 + 0.1 * c);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const p = b0 + j * (N + 1) + i; idx.push(p, p + 1, p + N + 1, p + 1, p + N + 2, p + N + 1); }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  g = mergeVertices(g, 1e-4); g.computeVertexNormals();
  return g;
}

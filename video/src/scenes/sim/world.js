// world.js: the simulated beach (sky, sea, sand, house on stilts, palms, clouds, bonfire, fireworks), the bedroom,
// and the grey grid void that shows when the world is wiped.
import * as THREE from 'three';
import { rngOf, hash } from './brain.js';

export const gy = z => 0.04 * Math.max(z, -8);   // sand height: the beach slopes into the sea at z = 0 (sea is z < 0)

const SKY_VS = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `
precision highp float;
varying vec3 vDir;
uniform vec3 top, hor, sunDir, sunCol, sunCol2;
uniform float sunR, glow, rect, lights, band, patchOn, patchKind, pseed, gexp, stars;
uniform vec4 pRect;   // azimuth, elevation (as y), half width, half height
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + pseed) * 43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float g = pow(max(d.y, 0.0), gexp);
  g = mix(g, floor(g * band + 0.5) / band, 0.7);
  vec3 col = mix(hor, top, g);
  if (stars > 0.0) { vec3 sp = floor(d * 200.0); float sh = fract(sin(dot(sp, vec3(12.9898, 78.233, 37.719))) * 43758.5453); col += vec3(0.9, 0.9, 1.0) * step(0.9975, sh) * stars * smoothstep(0.05, 0.3, d.y); }
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), sunDir)), u = cross(sunDir, r);
  float dz = dot(d, sunDir);
  vec2 a = vec2(dot(d, r), dot(d, u)) / max(dz, 1e-3);
  float dc = length(a) - sunR;
  float dr = max(abs(a.x) - sunR * 2.3, abs(a.y) - sunR * 0.6);
  float sd = mix(dc, dr, rect), inF = step(0.0, dz);
  col += sunCol * glow * exp(-max(sd, 0.0) * 2.2 / sunR) * inF * (1.0 - lights * 0.7);
  // lights on: a suspended ceiling
  vec3 ceilc = vec3(0.74, 0.86, 0.72);
  vec2 cu = d.xz / max(d.y, 0.03) * 0.9;
  float tl = max(step(0.955, fract(cu.x)), step(0.955, fract(cu.y))) * smoothstep(0.02, 0.2, d.y);
  ceilc *= 1.0 - 0.22 * tl;
  ceilc = mix(vec3(0.60, 0.68, 0.60), ceilc, smoothstep(-0.02, 0.06, d.y));
  col = mix(col, ceilc, lights);
  vec3 sc = mix(sunCol2, sunCol, smoothstep(-sunR, sunR * 0.6, a.y));
  float tube = smoothstep(0.22, 0.08, abs(abs(a.y) / (sunR * 0.6) - 0.5));
  sc = mix(sc, mix(vec3(0.82, 0.95, 0.84), vec3(1.0), tube) * 1.25, rect);
  float disc = smoothstep(0.0015, -0.0015, sd) * inF * step(-0.002, d.y + lights);
  col = mix(col, sc, disc);
  if (patchOn > 0.5) {
    float az = atan(d.x, -d.z);
    vec2 q = vec2(az, d.y), c = floor(q * 14.0);
    vec2 e = abs((c + 0.5) / 14.0 - pRect.xy) - pRect.zw;
    if (max(e.x, e.y) < 0.0 && h21(c) > 0.22) {
      if (patchKind < 0.5) {
        vec2 f = fract(q * 42.0);
        float ln = max(max(step(0.93, f.x), step(0.93, f.y)), step(0.94, fract(f.x + f.y)) );
        col = mix(vec3(0.01, 0.015, 0.05), vec3(0.2, 1.0, 0.75), ln);
      } else {
        vec2 f = floor(q * 56.0);
        col = mod(f.x + f.y, 2.0) < 0.5 ? vec3(1.0, 0.0, 1.0) : vec3(0.0);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const SEA_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SEA_FS = `
precision highp float;
varying vec3 vW;
uniform vec3 deep, shal, hor, sunDir, sunCol, camPos;
uniform float time, flatK, sunPow, sunAmt, calm;
void main(){
  vec2 p = vW.xz;
  float dist = length(vW - camPos);
  vec2 q = mix(floor(p * 1.6) / 1.6, p, smoothstep(25.0, 70.0, dist));
  float t = time;
  float amp = calm / (1.0 + dist * 0.012);
  vec3 N = normalize(vec3(
    (0.16 * cos(q.x * 0.9 + t * 1.3) + 0.09 * cos((q.x + q.y) * 2.3 + t * 2.7)) * amp, 1.0,
    (0.2 * cos(q.y * 1.7 - t * 1.9 + q.x * 0.3) + 0.09 * cos((q.x + q.y) * 2.3 + t * 2.7)) * amp));
  vec3 Vv = normalize(camPos - vW), R = reflect(-Vv, N);
  float fres = pow(1.0 - max(dot(Vv, N), 0.0), 3.0);
  vec3 col = mix(deep, shal, smoothstep(-22.0, -0.5, vW.z));
  col = mix(col, hor, clamp(fres * 0.85 + 0.06, 0.0, 1.0));
  col += sunCol * sunAmt * pow(max(dot(R, sunDir), 0.0), sunPow);
  float fo = vW.z + 0.55 + 0.3 * sin(vW.x * 0.7 + t * 0.9) + 0.12 * sin(vW.x * 2.3 - t * 1.4);
  col = mix(col, vec3(1.0), smoothstep(0.0, 0.12, fo) * 0.9);
  float fo2 = abs(vW.z + 3.2 + 0.5 * sin(vW.x * 0.4 + t * 0.6) + mod(t * 0.45, 2.6));
  col = mix(col, vec3(1.0), smoothstep(0.16, 0.05, fo2) * 0.55);
  col = mix(col, hor, smoothstep(80.0, 520.0, dist));
  vec2 tile = fract(p * 0.5);
  vec3 lino = vec3(0.50, 0.58, 0.50) * (1.0 - 0.25 * max(step(0.97, tile.x), step(0.97, tile.y)) * smoothstep(60.0, 20.0, dist));
  lino = mix(lino, vec3(0.60, 0.68, 0.60), smoothstep(40.0, 300.0, dist));
  col = mix(col, lino, flatK);
  gl_FragColor = vec4(col, 1.0);
}`;

const GRID_FS = `
precision highp float;
varying vec3 vW;
uniform vec3 bg, camPos;
void main(){
  vec2 p = vW.xz;
  vec2 w = fwidth(p) * 1.2;
  vec2 a = smoothstep(w, vec2(0.0), abs(fract(p - 0.5) - 0.5));
  vec2 b = smoothstep(w * 0.35, vec2(0.0), abs(fract(p / 5.0 - 0.5) - 0.5));
  float ln = max(max(a.x, a.y) * 0.45, max(b.x, b.y) * 0.9);
  float d = length(vW - camPos);
  ln *= smoothstep(70.0, 6.0, d);
  gl_FragColor = vec4(mix(bg * 0.97, bg * 0.45, ln), 1.0);
}`;

const ZF_FS = `
precision highp float;
uniform float frame; uniform vec3 colA, colB;
float h(float n){ return fract(sin(n * 91.7 + frame * 13.1) * 43758.5453); }
void main(){
  vec2 f = gl_FragCoord.xy;
  float row = floor(f.y / 9.0);
  float band = fract((f.x * 0.33 + f.y) / 30.0 + h(1.0) + 0.3 * h(row));
  if (band < 0.4 + 0.25 * h(row + 4.0)) discard;
  vec2 c = floor(f / 24.0);
  gl_FragColor = vec4(mod(c.x + c.y, 2.0) < 0.5 ? colA : colB, 1.0);
}`;

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

export function buildWorld() {
  const W = {}, scene = new THREE.Scene(), rnd = rngOf(77);
  W.scene = scene;
  const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const box = (parent, w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };

  // lights
  W.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); scene.add(W.hemi);
  W.sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(W.sun, W.sun.target);
  W.rim = new THREE.DirectionalLight(0xffffff, 0); scene.add(W.rim, W.rim.target);
  W.fireL = new THREE.PointLight(0xff8a30, 0, 14, 1.6); scene.add(W.fireL);

  // sky
  W.skyU = {
    top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color() }, sunCol2: { value: new THREE.Color() }, sunR: { value: 0.05 }, glow: { value: 0.5 },
    rect: { value: 0 }, lights: { value: 0 }, band: { value: 12 }, gexp: { value: 0.45 }, stars: { value: 0 }, patchOn: { value: 0 }, patchKind: { value: 0 }, pseed: { value: 0 },
    pRect: { value: new THREE.Vector4() },
  };
  W.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: W.skyU, side: THREE.BackSide, depthWrite: false, depthTest: false }));
  W.sky.renderOrder = -10; W.sky.frustumCulled = false; scene.add(W.sky);

  // beach group: everything that the wipe erases
  const beach = W.beach = new THREE.Group(); scene.add(beach);
  W.seaU = {
    deep: { value: new THREE.Color() }, shal: { value: new THREE.Color() }, hor: W.skyU.hor, sunDir: W.skyU.sunDir, sunCol: { value: new THREE.Color() },
    camPos: { value: new THREE.Vector3() }, time: { value: 0 }, flatK: { value: 0 }, sunPow: { value: 40 }, sunAmt: { value: 1 }, calm: { value: 1 },
  };
  W.sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.ShaderMaterial({ vertexShader: SEA_VS, fragmentShader: SEA_FS, uniforms: W.seaU }));
  W.sea.rotation.x = -Math.PI / 2; beach.add(W.sea);

  const sandTex = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#ffdf6e'; c.fillRect(0, 0, w, h);
    const r = rngOf(5);
    for (let i = 0; i < 14; i++) { c.fillStyle = `rgba(255,${190 + r() * 50 | 0},60,${0.1 + r() * 0.12})`; c.beginPath(); c.arc(r() * w, r() * h, 20 + r() * 50, 0, 7); c.fill(); }
    for (let i = 0; i < 900; i++) { c.fillStyle = r() < 0.5 ? 'rgba(255,255,220,.5)' : 'rgba(215,150,40,.45)'; c.fillRect(r() * w, r() * h, 2, 2); }
    c.strokeStyle = 'rgba(200,140,40,.35)'; c.lineWidth = 3; c.strokeRect(0, 0, w, h);
  }, [70, 14]);
  W.sandMat = lam(0xffffff, { map: sandTex });
  const sg = new THREE.BufferGeometry(), Z0 = -8, Z1 = 90, XW = 260;
  sg.setAttribute('position', new THREE.Float32BufferAttribute([-XW, gy(Z0), Z0, XW, gy(Z0), Z0, -XW, gy(Z1), Z1, XW, gy(Z1), Z1], 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2)); sg.setIndex([0, 2, 1, 1, 2, 3]); sg.computeVertexNormals();
  W.sand = new THREE.Mesh(sg, W.sandMat); beach.add(W.sand);

  // z-fighting patches: one on the sand, one on the house wall (shown only during glitch events)
  W.zfU = { frame: { value: 0 }, colA: { value: new THREE.Color(0xff3ad0) }, colB: { value: new THREE.Color(0x101018) } };
  const zfMat = new THREE.ShaderMaterial({ vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: ZF_FS, uniforms: W.zfU, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  W.zfSand = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), zfMat); W.zfSand.rotation.x = -Math.PI / 2 + 0.04; W.zfSand.visible = false; beach.add(W.zfSand);

  // house on stilts over the shallows, with a jetty to the sand
  const house = W.house = new THREE.Group(); beach.add(house);
  const wood = lam(0xa8672e), white = lam(0xfff6e6), teal = lam(0x13d6c2), roofM = lam(0xff4a2a), glass = new THREE.MeshPhongMaterial({ color: 0x0b2a66, shininess: 120, specular: 0xffffff });
  for (const x of [-2.6, 0, 2.6]) for (const z of [-2, 2]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3, 8), wood); s.position.set(x, 1.0, z); house.add(s); }
  box(house, 6.4, 0.22, 5.2, wood, 0, 2.5, 0);
  box(house, 4.6, 2.5, 3.4, white, -0.5, 3.86, -0.6);
  box(house, 4.7, 0.25, 3.5, teal, -0.5, 2.74, -0.6);
  const rs = new THREE.Shape(); rs.moveTo(-2.9, 0); rs.lineTo(2.9, 0); rs.lineTo(0, 1.7); rs.closePath();
  W.roof = new THREE.Mesh(new THREE.ExtrudeGeometry(rs, { depth: 4.2, bevelEnabled: false }), roofM); W.roof.position.set(-0.5, 5.1, -2.7); house.add(W.roof);
  box(house, 0.9, 1.8, 0.08, teal, 0.6, 3.5, 1.12);
  box(house, 1.1, 0.9, 0.08, glass, -1.5, 3.9, 1.12); box(house, 0.08, 0.9, 1.1, glass, 1.82, 3.9, -0.6);
  for (let i = 0; i < 7; i++) box(house, 0.08, 0.8, 0.08, white, -3.1 + i * 1.03, 3.0, 2.5);
  box(house, 6.4, 0.08, 0.1, white, 0, 3.42, 2.5);
  // jetty + steps down to the sand
  box(house, 1.3, 0.14, 4.2, wood, 2.3, 2.45, 4.6);
  for (let i = 0; i < 8; i++) box(house, 1.3, 0.12, 0.42, wood, 2.3, 2.3 - i * 0.29, 6.9 + i * 0.42);
  for (const z of [3.6, 6.4]) for (const x of [1.75, 2.85]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.9, 6), wood); s.position.set(x, 1.0, z); house.add(s); }
  W.zfWall = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), zfMat); W.zfWall.position.set(-1.3, 3.8, 1.11); W.zfWall.visible = false; house.add(W.zfWall);
  box(house, 1.3, 0.12, 4.6, wood, 2.3, 0.2, 12.3);
  house.position.set(0.5, 0, -13); house.rotation.y = 0.25;

  // palms
  const trunkM = lam(0xb9783a), leafM = lam(0x19d24a, { side: THREE.DoubleSide, flatShading: true }), nutM = lam(0x6b3d12);
  const frondG = new THREE.PlaneGeometry(0.8, 2.8, 2, 7); frondG.translate(0, 1.4, 0);
  { const p = frondG.attributes.position, th = 1.75, R = 2.8 / th;
    for (let i = 0; i < p.count; i++) { const s = p.getY(i) / 2.8, x = p.getX(i) * Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.88)); p.setXYZ(i, x, R * Math.sin(s * th), R * (1 - Math.cos(s * th)) + Math.abs(x) * 0.5); }
    frondG.computeVertexNormals(); }
  W.palms = [];
  const palm = (x, z, h, lean, dir) => {
    const g = new THREE.Group(); let px = 0, py = 0;
    for (let i = 0; i < 7; i++) {
      const u = (i + 1) / 7, nx = lean * u * u, ny = h * u, m = new THREE.Mesh(new THREE.CylinderGeometry(0.15 - 0.05 * u, 0.17 - 0.05 * u, 1, 7), trunkM);
      const a = new THREE.Vector3(px, py, 0), b = new THREE.Vector3(nx, ny, 0), d = b.clone().sub(a);
      m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.y = d.length() * 1.04; m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(m); px = nx; py = ny;
    }
    const crown = new THREE.Group(); crown.position.set(px, py, 0); g.add(crown);
    for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(frondG, leafM); f.rotation.order = 'YXZ'; f.rotation.set(0.55 + rnd() * 0.5, i * Math.PI * 2 / 9 + rnd() * 0.4, 0); f.scale.setScalar(0.85 + rnd() * 0.4); crown.add(f); }
    for (let i = 0; i < 3; i++) { const n = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), nutM); n.position.set(Math.cos(i * 2.1) * 0.2, -0.15, Math.sin(i * 2.1) * 0.2); crown.add(n); }
    g.position.set(x, gy(z) - 0.1, z); g.rotation.y = dir; g.userData = { crown, home: g.position.clone() }; beach.add(g); W.palms.push(g); return g;
  };
  palm(-13.5, 4, 6.5, 1.6, 0.4); palm(-10.5, 7, 5.2, -1.2, 1.2); palm(13.2, 2.6, 6.8, -2.0, 0.2); palm(15.5, 6.5, 5.5, 1.4, 2.5);
  palm(-4.5, 10.5, 5.8, 1.5, -0.5); palm(22, 5, 6.2, -1.4, 0.9); palm(-24, 9, 7, 1.8, 0.1); palm(17, 12, 6.4, 1.0, 1.9);

  // far islands and clouds
  const hillM = lam(0x21c065, { flatShading: true });
  for (const [x, z, r, h] of [[-160, -420, 70, 34], [-80, -460, 45, 20], [230, -400, 90, 40]]) { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7, 2), hillM); m.position.set(x, h / 2 - 2, z); beach.add(m); }
  W.clouds = []; W.cloudM = lam(0xffffff, { flatShading: true, emissive: 0x555555 });
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group(), n = 3 + (rnd() * 3 | 0);
    for (let j = 0; j < n; j++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), W.cloudM); m.scale.set(9 + rnd() * 8, 4 + rnd() * 3, 6 + rnd() * 4); m.position.set((j - n / 2) * 9 + rnd() * 4, rnd() * 2, rnd() * 4); g.add(m); }
    g.position.set(-260 + i * 90 + rnd() * 40, 55 + rnd() * 50, -380 - rnd() * 80); g.userData.home = g.position.clone(); beach.add(g); W.clouds.push(g);
  }

  // bonfire
  const fire = W.fire = new THREE.Group(); beach.add(fire);
  const stoneM = lam(0x8d8f99, { flatShading: true }), logM = lam(0x5a3214);
  for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), stoneM); s.position.set(Math.cos(i * 0.7) * 0.62, 0.06, Math.sin(i * 0.7) * 0.62); s.rotation.set(i, i * 2, 0); fire.add(s); }
  for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.0, 6), logM); l.rotation.set(0, i * 1.26, 1.0); l.position.set(Math.cos(i * 1.26) * -0.14, 0.3, Math.sin(i * 1.26) * 0.14); fire.add(l); }
  W.flames = [];
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.3 - (i % 3) * 0.06, 1.1, 6, 1, true), new THREE.MeshBasicMaterial({ color: [0xff5a10, 0xffa020, 0xffe060][i % 3], transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.geometry.translate(0, 0.55, 0); m.position.set(Math.cos(i * 0.9) * 0.16 * (i % 3 ? 1 : 0), 0.18, Math.sin(i * 0.9) * 0.16 * (i % 3 ? 1 : 0)); fire.add(m); W.flames.push(m);
  }
  const dot = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
  const points = (n, size) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false })); p.frustumCulled = false; return p;
  };
  W.embers = points(70, 9); beach.add(W.embers);
  W.fw = points(18 * 70, 24); beach.add(W.fw);
  W.fwDirs = Array.from({ length: 90 }, () => { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), v = 0.75 + rnd() * 0.35; return [s * Math.cos(a) * v, u * v, s * Math.sin(a) * v]; });

  // bedroom (hands mode): its own group, floor at y = 0 of the group
  const room = W.room = new THREE.Group(); scene.add(room); room.visible = false;
  const wallM = lam(0xf4efe6), floorT = canvasTex(256, 256, (c, w, h) => { const r = rngOf(9); for (let i = 0; i < 8; i++) { c.fillStyle = `hsl(${26 + r() * 6},62%,${50 + r() * 10}%)`; c.fillRect(i * 32, 0, 32, h); c.fillStyle = 'rgba(70,35,10,.5)'; c.fillRect(i * 32, 0, 2, h); c.fillRect(i * 32, (r() * h) | 0, 32, 2); } }, [4, 4]);
  const floorM = lam(0xffffff, { map: floorT });
  box(room, 7, 0.2, 6.5, floorM, 0, -0.1, -0.25);
  box(room, 7, 0.2, 6.5, wallM, 0, 2.85, -0.25);
  // back wall (z = -3) with a window x ∈ [-2.7, -0.4], y ∈ [0.8, 2.25]
  box(room, 0.5, 2.8, 0.16, wallM, -3.0, 1.4, -3); box(room, 3.7, 2.8, 0.16, wallM, 1.45, 1.4, -3);
  box(room, 2.4, 0.8, 0.16, wallM, -1.55, 0.4, -3); box(room, 2.4, 0.55, 0.16, wallM, -1.55, 2.52, -3);
  box(room, 0.2, 2.8, 6.5, wallM, -3.2, 1.4, -0.25); box(room, 0.2, 2.8, 6.5, wallM, 3.2, 1.4, -0.25); box(room, 7, 2.8, 0.2, wallM, 0, 1.4, 3.0);
  const frameM = lam(0xffffff);
  box(room, 2.4, 0.07, 0.2, frameM, -1.55, 0.8, -2.95); box(room, 0.06, 1.45, 0.1, frameM, -1.55, 1.52, -2.98); box(room, 2.3, 0.05, 0.1, frameM, -1.55, 1.55, -2.98);
  W.curtains = [-2.75, -0.38].map(x => { const m = box(room, 0.5, 1.75, 0.06, new THREE.MeshLambertMaterial({ color: 0xffe9c4, transparent: true, opacity: 0.85, emissive: 0x6a4a20 }), x, 1.5, -2.82); return m; });
  // bed
  const sheetM = lam(0xffffff), blanketM = lam(0x2f7de0), pillowM = lam(0xfff8ee), bedW = lam(0x9a5a2a);
  box(room, 2.2, 0.3, 2.3, bedW, 1.7, 0.2, -1.75); box(room, 2.1, 0.22, 2.2, sheetM, 1.7, 0.46, -1.75); box(room, 2.14, 0.1, 1.4, blanketM, 1.7, 0.56, -1.3);
  box(room, 2.2, 1.0, 0.1, bedW, 1.7, 0.7, -2.88);
  for (const x of [1.2, 2.2]) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), pillowM); p.scale.set(1.15, 0.35, 0.7); p.position.set(x, 0.66, -2.5); room.add(p); }
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), lam(0xff5a7a)); rug.rotation.x = -Math.PI / 2; rug.position.set(-0.2, 0.012, 0); room.add(rug);
  box(room, 0.5, 0.5, 0.45, bedW, 0.15, 0.25, -2.7);
  const lamp = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.26, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0xffe2a0, emissive: 0x7a5a20, side: THREE.DoubleSide })); lamp.position.set(0.15, 0.82, -2.7); room.add(lamp);
  box(room, 0.03, 0.3, 0.03, bedW, 0.15, 0.62, -2.7);
  // framed picture: two jars on a shelf
  const pic = canvasTex(128, 96, (c) => { c.fillStyle = '#12161a'; c.fillRect(0, 0, 128, 96); c.fillStyle = '#39413a'; c.fillRect(0, 70, 128, 6); for (const [x, col] of [[36, '#9dbf6a'], [80, '#c59a3a']]) { c.fillStyle = col; c.globalAlpha = 0.75; c.fillRect(x, 30, 22, 40); c.globalAlpha = 1; c.fillStyle = '#e8a4a8'; c.beginPath(); c.arc(x + 11, 52, 7, 0, 7); c.fill(); c.fillStyle = '#777'; c.fillRect(x - 1, 26, 24, 5); } });
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), new THREE.MeshBasicMaterial({ map: pic })); pm.position.set(2.45, 1.75, -2.91); room.add(pm);
  box(room, 0.7, 0.54, 0.03, bedW, 2.45, 1.75, -2.925);
  // window light on the floor
  W.lightPatch = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.6), new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  W.lightPatch.rotation.x = -Math.PI / 2; W.lightPatch.position.set(-0.9, 0.02, -1.3); W.lightPatch.rotation.z = -0.35; room.add(W.lightPatch);
  W.roomL = new THREE.PointLight(0xffc890, 0, 9, 1.2); W.roomL.position.set(-1.4, 1.6, -2.2); room.add(W.roomL);

  // void: grid floor (shown in the second pass)
  W.voidBg = new THREE.Color(0xd0d4d8);
  W.gridU = { bg: { value: W.voidBg }, camPos: W.seaU.camPos };
  W.grid = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShaderMaterial({ vertexShader: SEA_VS, fragmentShader: GRID_FS, uniforms: W.gridU }));
  W.grid.rotation.x = -Math.PI / 2; W.grid.visible = false; scene.add(W.grid);
  W.wire = new THREE.MeshBasicMaterial({ color: 0x14181c, wireframe: true });

  // per-frame animation of the set pieces
  W.animate = (t, beat, fireAt, fireK, fwK, fwC) => {
    W.seaU.time.value = t; W.zfU.frame.value = Math.round(t * 30);
    for (const p of W.palms) { p.userData.crown.rotation.z = 0.05 * Math.sin(t * 0.9 + p.position.x); p.userData.crown.rotation.x = 0.04 * Math.sin(t * 1.3 + p.position.z); }
    for (const c of W.clouds) c.position.x = c.userData.home.x + t * 0.6;
    W.curtains.forEach((c, i) => { c.rotation.y = 0.12 * Math.sin(t * 0.8 + i * 2); c.scale.x = 1 + 0.08 * Math.sin(t * 0.6 + i); });
    // fire
    fire.visible = fireK > 0; W.embers.visible = fireK > 0;
    if (fireK > 0) {
      fire.position.set(fireAt[0], gy(fireAt[1]), fireAt[1]);
      const pump = 1 + 0.45 * beat.pulse;
      W.flames.forEach((m, i) => { const s = (0.75 + 0.3 * Math.sin(t * 9 + i * 2.1) + 0.2 * Math.sin(t * 17.3 + i * 1.3)) * pump * fireK; m.scale.set(0.8 + 0.2 * Math.sin(t * 7 + i), s, 0.8 + 0.2 * Math.cos(t * 6 + i)); m.rotation.y = t * (1 + i * 0.3); });
      W.fireL.position.set(fireAt[0], gy(fireAt[1]) + 0.9, fireAt[1]);
      const ep = W.embers.geometry.attributes.position, ec = W.embers.geometry.attributes.color;
      for (let i = 0; i < ep.count; i++) {
        const life = 1.6 + hash(i, 1) * 1.6, a = ((t + hash(i, 2) * 9) % life) / life, r = 0.15 + hash(i, 3) * 0.35, an = hash(i, 4) * 6.283 + a * 2;
        ep.setXYZ(i, fireAt[0] + Math.cos(an) * r * (1 + a * 1.5) + a * a * 0.6, gy(fireAt[1]) + 0.5 + a * (2.2 + hash(i, 5) * 2.2), fireAt[1] + Math.sin(an) * r * (1 + a * 1.5));
        const b = (1 - a) * (0.6 + 0.4 * Math.sin(t * 20 + i)); ec.setXYZ(i, b, b * 0.45, b * 0.08);
      }
      ep.needsUpdate = ec.needsUpdate = true;
    }
    // fireworks: one burst every two beats, each a function of its own beat time
    W.fw.visible = fwK > 0; W.fwFlash = 0;
    if (fwK > 0) {
      const fp = W.fw.geometry.attributes.position, fc = W.fw.geometry.attributes.color, col = new THREE.Color();
      for (let j = 0; j < 6; j++) for (let c = 0; c < 3; c++) {
        const bi = beat.index - j, id = bi * 3 + c, age = (beat.phase + j) * beat.period + c * 0.11, live = age < 2.4 && hash(id, 11) < fwK * 0.85;
        const az = hash(id, 12) * 6.2832, cx = fwC[0] + Math.sin(az) * 150, cz = fwC[2] - Math.cos(az) * 150, cy = 16 + hash(id, 13) * 26, R = 13 + hash(id, 15) * 13;
        col.setHSL(hash(id, 16), 1, 0.6);
        const e = 1 - Math.exp(-age * 3.2), fade = Math.max(0, 1 - age / 2.4);
        if (live) W.fwFlash += Math.exp(-age * 6) * 0.5;
        for (let i = 0; i < 70; i++) {
          const k = (j * 3 + c) * 70 + i, d = W.fwDirs[i];
          if (!live) { fp.setXYZ(k, 0, -999, 0); continue; }
          fp.setXYZ(k, cx + d[0] * R * e, cy + d[1] * R * e - age * age * 2.5, cz + d[2] * R * e);
          const b = fade * fade * (0.55 + 0.45 * Math.sin(age * 30 + i * 1.7)) * (i % 5 === 0 ? 1.6 : 1);
          fc.setXYZ(k, col.r * b + 0.25 * b * b, col.g * b + 0.25 * b * b, col.b * b + 0.25 * b * b);
        }
      }
      fp.needsUpdate = fc.needsUpdate = true;
    }
  };
  return W;
}

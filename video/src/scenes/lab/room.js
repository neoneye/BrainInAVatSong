// room.js: the laboratory around the two jars: tiled back wall, steel shelves, fluorescent tubes, the instanced
// neighbour jars, the hospital curtain, and the canvas textures (nurse shadow, tape, label, glow).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LIT, rngOf, hash2, makeBrain, cerebellumGeo, brainMaterial, glassMaterial, fluidMaterial, EyeSet } from './parts.js';

export const R = 1.0, JX = 1.5, GY0 = 0.14, GY1 = 2.84, SH = 4.3, PITCH = 3.0, WALLZ = -1.75;

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const tex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

export function radialTexture() {
  const c = canvas(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, '#999'); gr.addColorStop(0.6, '#2a2a2a'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return tex(c, false);
}
// white-on-black masks, blurred: the nurse (cap, raised arm with a syringe) and a gloved hand reaching in
export function nurseTextures() {
  const c = canvas(512, 512), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512); g.filter = 'blur(5px)'; g.fillStyle = g.strokeStyle = '#fff'; g.lineCap = g.lineJoin = 'round';
  g.beginPath(); g.ellipse(250, 118, 34, 44, 0, 0, 7); g.fill();                                   // head
  g.beginPath(); g.moveTo(212, 92); g.lineTo(288, 92); g.lineTo(300, 52); g.lineTo(250, 40); g.lineTo(200, 52); g.closePath(); g.fill();  // cap
  g.beginPath(); g.arc(286, 132, 20, 0, 7); g.fill();                                               // bun
  g.fillRect(238, 150, 24, 34);                                                                     // neck
  g.beginPath(); g.moveTo(176, 196); g.quadraticCurveTo(250, 160, 324, 196); g.lineTo(304, 352); g.quadraticCurveTo(360, 440, 372, 512); g.lineTo(128, 512); g.quadraticCurveTo(140, 440, 196, 352); g.closePath(); g.fill(); // body, skirt
  g.lineWidth = 30; g.beginPath(); g.moveTo(184, 204); g.lineTo(160, 300); g.lineTo(172, 390); g.stroke();                      // hanging arm
  g.lineWidth = 28; g.beginPath(); g.moveTo(318, 204); g.lineTo(386, 262); g.lineTo(404, 160); g.stroke();                      // raised arm
  g.beginPath(); g.ellipse(406, 146, 15, 20, 0, 0, 7); g.fill();                                                                // fist
  g.lineWidth = 11; g.beginPath(); g.moveTo(408, 136); g.lineTo(414, 60); g.stroke();                                           // syringe barrel
  g.lineWidth = 3; g.beginPath(); g.moveTo(414, 60); g.lineTo(417, 14); g.stroke();                                             // needle
  g.lineWidth = 5; g.beginPath(); g.moveTo(396, 150); g.lineTo(422, 152); g.stroke();
  const h = canvas(512, 512), q = h.getContext('2d');
  q.fillStyle = '#000'; q.fillRect(0, 0, 512, 512); q.filter = 'blur(9px)'; q.fillStyle = q.strokeStyle = '#fff'; q.lineCap = q.lineJoin = 'round';
  q.lineWidth = 92; q.beginPath(); q.moveTo(540, 110); q.lineTo(330, 250); q.stroke();              // forearm from the upper right
  q.beginPath(); q.ellipse(290, 276, 74, 62, -0.6, 0, 7); q.fill();                                 // palm
  const fingers = [[236, 230, 150, 150, 96, 150], [226, 270, 120, 250, 60, 276], [236, 310, 140, 340, 84, 392], [262, 336, 200, 410, 168, 468], [330, 322, 330, 400, 300, 440]];
  for (const [x0, y0, x1, y1, x2, y2] of fingers) { q.lineWidth = 27; q.beginPath(); q.moveTo(x0, y0); q.quadraticCurveTo(x1, y1, x2, y2); q.stroke(); }
  return { nurse: tex(c, false), hand: tex(h, false) };
}
export function tapeTexture() {
  const c = canvas(256, 192), g = c.getContext('2d'), r = rngOf(77);
  const strip = (cx, cy, w, h, rot) => { g.save(); g.translate(cx, cy); g.rotate(rot); g.fillStyle = '#b9ab84'; g.fillRect(-w / 2, -h / 2, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '60,50,30' : '235,225,190'},${0.05 + r() * 0.1})`; g.fillRect(-w / 2 + r() * w, -h / 2 + r() * h, 2 + r() * 14, 1.5); }
    g.fillStyle = 'rgba(40,30,10,.35)'; g.fillRect(-w / 2, -h / 2, w, 3); g.fillRect(-w / 2, h / 2 - 3, w, 3);
    for (let x = -w / 2; x < w / 2; x += 5) { g.clearRect(x, -h / 2 - 1, 2.5, 3 + r() * 3); }    // torn serrated end… cheap fray
    g.restore(); };
  strip(128, 96, 236, 62, -0.1); strip(128, 96, 190, 54, 1.02); strip(120, 110, 150, 46, -0.9);
  const st = g.createRadialGradient(140, 150, 4, 140, 150, 70); st.addColorStop(0, 'rgba(40,60,10,.75)'); st.addColorStop(1, 'rgba(40,60,10,0)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = st; g.fillRect(0, 0, 256, 192);
  return tex(c);
}
export function labelTexture(text) {
  const c = canvas(384, 256), g = c.getContext('2d'), r = rngOf(31);
  g.fillStyle = '#cfc7ad'; g.fillRect(0, 0, 384, 256);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,70,30,${0.03 + r() * 0.07})`; g.beginPath(); g.arc(r() * 384, r() * 256, 8 + r() * 50, 0, 7); g.fill(); }
  g.strokeStyle = '#1a1712'; g.lineWidth = 5; g.strokeRect(10, 10, 364, 236); g.lineWidth = 2; g.beginPath(); g.moveTo(10, 62); g.lineTo(374, 62); g.stroke();
  g.fillStyle = '#1a1712'; g.font = '700 26px "IBM Plex Mono"'; g.textBaseline = 'middle'; g.fillText('SPECIMEN', 26, 37); g.textAlign = 'right'; g.fillText('No. 08', 358, 37);
  g.textAlign = 'center'; g.font = '700 190px "Caveat"'; g.save(); g.translate(192, 158); g.rotate(-0.05); g.fillStyle = '#14100c'; g.fillText(text, 0, 0); g.restore();
  return tex(c);
}

// ───────────────────────── wall, shelves, tubes ─────────────────────────
export function buildRoom(G, env) {
  const g = new THREE.Group(), U = {
    ...G, uWallK: { value: 0.05 }, uTubeK: { value: 1 }, uTubeCol: { value: new THREE.Color(0.8, 1, 0.92) },
    uGA: { value: new THREE.Vector4(-JX, 1.2, 0, 0) }, uGB: { value: new THREE.Vector4(JX, 1.2, 0, 0) }, uCA: { value: new THREE.Color() }, uCB: { value: new THREE.Color() }, uMid: { value: new THREE.Color(0, 0, 0) },
  };
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(110, 26), new THREE.ShaderMaterial({ uniforms: U,
    vertexShader: `varying vec3 vW; varying float vFog; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${LIT}
      uniform float uWallK, uTubeK; uniform vec3 uTubeCol, uCA, uCB, uMid; uniform vec4 uGA, uGB; varying vec3 vW; varying float vFog;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main() { vec2 t = vW.xy / vec2(0.62, 0.62) + vec2(0.37, 0.21); vec2 f = fract(t), id = floor(t);
        float grout = max(smoothstep(0.045, 0.0, min(f.x, 1.0 - f.x)), smoothstep(0.045, 0.0, min(f.y, 1.0 - f.y)));
        float grime = vnoise(vW.xy * 0.7) * 0.6 + vnoise(vW.xy * vec2(3.0, 0.5) + 7.0) * 0.4;
        vec3 tile = vec3(0.55, 0.62, 0.58) * (0.72 + 0.28 * h2(id)) * (0.45 + 0.75 * grime);
        tile = mix(tile, vec3(0.05, 0.06, 0.05), grout * 0.85);
        tile *= 1.0 - 0.5 * smoothstep(0.55, 0.9, vnoise(vec2(vW.x * 2.2, vW.y * 0.25 + 3.0))) * smoothstep(0.3, 0.0, fract(vW.y / ${SH.toFixed(1)}));
        float px = mod(vW.x + 6.0, 12.0) - 6.0, py = mod(vW.y + 0.5, ${SH.toFixed(1)}) - 0.5;
        float pool = exp(-px * px / 9.0) * exp(-pow(vW.y - 3.4, 2.0) / 2.6);
        vec3 light = uKeyCol * uWallK + uAmb + uTubeCol * uTubeK * pool * 0.035;
        vec2 da = vW.xy - uGA.xy, db = vW.xy - uGB.xy;
        light += uCA * uGA.w * exp(-dot(da, da) / 3.0) + uCB * uGB.w * exp(-dot(db, db) / 3.0);
        vec2 dm = vW.xy - vec2(0.0, 1.45); light += uMid * exp(-dot(dm, dm) / 1.2);
        gl_FragColor = vec4(tile * light * fogF(vFog), 1.0); }` }));
  wall.position.set(0, 4, WALLZ); g.add(wall);

  const steel = new THREE.MeshStandardMaterial({ color: 0x70777b, metalness: 0.92, roughness: 0.36 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1e21, metalness: 0.8, roughness: 0.45 });
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(100, 0.12, 3.2), steel, 4), d = new THREE.Object3D();
  for (let r = 0; r < 4; r++) { d.position.set(0, (r - 1) * SH - 0.06, 0.06 + WALLZ + 1.6 + 0.05); d.updateMatrix(); boards.setMatrixAt(r, d.matrix); }
  boards.frustumCulled = false; g.add(boards);
  const lip = new THREE.InstancedMesh(new THREE.BoxGeometry(100, 0.2, 0.05), dark, 4);
  for (let r = 0; r < 4; r++) { d.position.set(0, (r - 1) * SH - 0.1, 1.585); d.updateMatrix(); lip.setMatrixAt(r, d.matrix); }
  lip.frustumCulled = false; g.add(lip);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 3 * SH + 2, 0.14), dark, 18);
  for (let i = 0; i < 18; i++) { d.position.set((i - 8.5) * 6, SH * 0.5, 1.52); d.updateMatrix(); posts.setMatrixAt(i, d.matrix); }
  posts.frustumCulled = false; g.add(posts);
  // carriage rail of the hero shelf
  const rail = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.02, 0.36), dark); rail.position.set(0, 0.008, 0); g.add(rail);

  // fluorescent tubes under the shelf above (one over the heroes, others every 12 units)
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const tubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 4.6, 10, 1).rotateZ(Math.PI / 2), tubeMat, 7);
  const hous = new THREE.InstancedMesh(new THREE.BoxGeometry(4.9, 0.1, 0.34), dark, 7);
  for (let i = 0; i < 7; i++) { d.position.set((i - 3) * 12, SH - 0.33, 1.0); d.updateMatrix(); tubes.setMatrixAt(i, d.matrix); d.position.y += 0.13; d.updateMatrix(); hous.setMatrixAt(i, d.matrix); }
  tubes.frustumCulled = hous.frustumCulled = false; g.add(tubes, hous);
  return { group: g, U, tubeMat, steel, dark, wall };
}

// ───────────────────────── neighbour jars (instanced) ─────────────────────────
export function jarGeos() {
  const glass = new THREE.CylinderGeometry(R, R, GY1 - GY0, 48, 1, true).translate(0, (GY0 + GY1) / 2, 0);
  const fluid = new THREE.CylinderGeometry(R - 0.045, R - 0.045, 1, 40, 8, true).translate(0, 0.5, 0);
  const surf = new THREE.CircleGeometry(R - 0.045, 40).rotateX(-Math.PI / 2);
  const lid = mergeGeometries([
    new THREE.CylinderGeometry(R * 1.06, R * 1.06, 0.2, 48).translate(0, GY1 + 0.1, 0),
    new THREE.CylinderGeometry(0.5, 0.56, 0.1, 32).translate(0, GY1 + 0.25, 0),
    new THREE.CylinderGeometry(R * 1.1, R * 1.15, GY0, 48).translate(0, GY0 / 2, 0),
  ]);
  const lamp = new THREE.CircleGeometry(R - 0.1, 40).rotateX(-Math.PI / 2).translate(0, GY0 + 0.012, 0);
  return { glass, fluid, surf, lid, lamp };
}
export function buildNeighbours(G, geos, dark, radial) {
  const slots = [], rnd = rngOf(4242);
  for (let r = -1; r <= 1; r++) for (let c = -13; c <= 12; c++) {
    const hero = r === 0 && (c === -1 || c === 0), k = rnd();
    slots.push({ x: PITCH * (c + 0.5), y: r * SH, hero, kind: hero ? 0 : k < 0.08 ? 2 : k < 0.2 ? 1 : 0,       // 0 alive, 1 dim/dead, 2 empty
      yaw: (rnd() - 0.5) * 1.6, level: 1.7 + rnd() * 0.75, glow: 0.3 + rnd() * 0.45, hue: rnd(), by: 1.25 + rnd() * 0.3, bs: 0.5 + rnd() * 0.1, ph: rnd() * 6.28, col: new THREE.Color(), bcol: new THREE.Color() });
  }
  const n = slots.length, g = new THREE.Group(), d = new THREE.Object3D();
  const nGlow = { value: 0.5 }, col = new Float32Array(n * 3), lg = new Float32Array(n * 2);
  for (const [i, s] of slots.entries()) {
    s.col.setRGB(0.35 + 0.65 * s.hue, 0.85, 0.22 + 0.2 * (1 - s.hue)); if (s.kind === 1) s.glow *= 0.25;
    col.set([s.col.r, s.col.g, s.col.b], i * 3); lg.set([s.level, s.glow], i * 2);
    s.bcol.setHSL(0.97 + (rnd() - 0.5) * 0.08, 0.3 + rnd() * 0.25, 0.42 + rnd() * 0.2);
  }
  const aCol = new THREE.InstancedBufferAttribute(col, 3), aLG = new THREE.InstancedBufferAttribute(lg, 2);
  const mk = (geo, mat, order) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; m.renderOrder = order; g.add(m); return m; };
  const fg = geos.fluid.clone(); fg.setAttribute('aCol', aCol); fg.setAttribute('aLG', aLG);
  const sg = geos.surf.clone(); sg.setAttribute('aCol', aCol); sg.setAttribute('aLG', aLG);
  const meshes = {
    back: mk(fg, fluidMaterial(G, 'back', true, { glow: nGlow }), 1), front: mk(fg, fluidMaterial(G, 'front', true, { glow: nGlow, murk: 0.5 }), 3), surf: mk(sg, fluidMaterial(G, 'surf', true, { glow: nGlow }), 3),
    glass: mk(geos.glass, glassMaterial(G, { glowK: nGlow }), 4), lid: mk(geos.lid, dark, 0),
    lamp: mk(geos.lamp, new THREE.MeshBasicMaterial({ color: 0xffffff }), 0),
    pool: mk(new THREE.PlaneGeometry(4.2, 3.0).rotateX(-Math.PI / 2).translate(0, 0.014, 0.1), new THREE.MeshBasicMaterial({ map: radial, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true }), 0),
  };
  meshes.glass.material.uniforms.uGlowCol.value.setRGB(0.5, 0.85, 0.3);
  const nb = makeBrain(5, 20, 4.0, 1.1), bgeo = mergeGeometries([nb.geo, (() => { const c = cerebellumGeo(); c.deleteAttribute('uv'); return c; })()]);
  const bmat = brainMaterial(G, { color: 0xffffff, key: 'inst' }); bmat.userData.u.uUnderCol.value.setRGB(0.5, 0.9, 0.3);
  meshes.brain = mk(bgeo, bmat, 0);
  const eyes = new EyeSet(n * 2, G); g.add(eyes.mesh);
  const c = new THREE.Color();
  for (const [i, s] of slots.entries()) {
    eyes.style(i * 2, [0.5 + 0.5 * s.hue, 0.75, 0.3 + 0.5 * (1 - s.hue)], [s.bcol.r * 0.8, s.bcol.g * 0.7, s.bcol.b * 0.7]); eyes.style(i * 2 + 1, [0.5 + 0.5 * s.hue, 0.75, 0.3 + 0.5 * (1 - s.hue)], [s.bcol.r * 0.8, s.bcol.g * 0.7, s.bcol.b * 0.7]);
    meshes.lamp.setColorAt(i, c.copy(s.col).multiplyScalar(s.glow * 2.2)); meshes.pool.setColorAt(i, c.copy(s.col).multiplyScalar(s.glow * 0.35)); meshes.brain.setColorAt(i, s.bcol);
  }
  // place: heroes' slots are only shown when `showHeroSlots`
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function place(showHeroSlots, hideAll) {
    for (const [i, s] of slots.entries()) {
      const on = !hideAll && (!s.hero || showHeroSlots);
      d.position.set(s.x, s.y, 0); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix();
      for (const k of ['back', 'front', 'surf', 'glass', 'lid', 'lamp', 'pool']) meshes[k].setMatrixAt(i, on ? d.matrix : zero);
      d.position.set(s.x, s.y + s.by, 0); d.rotation.set(0.05, s.yaw, 0.08 * Math.sin(s.ph)); d.scale.setScalar(s.bs); d.updateMatrix();
      meshes.brain.setMatrixAt(i, on && s.kind !== 2 ? d.matrix : zero);
    }
    for (const k in meshes) meshes[k].instanceMatrix.needsUpdate = true;
  }
  return { group: g, slots, meshes, eyes, nGlow, aLG, lg, place, lampMat: meshes.lamp.material, poolMat: meshes.pool.material };
}

// ───────────────────────── curtain ─────────────────────────
export function buildCurtain(G, dark) {
  const g = new THREE.Group();
  const U = { ...G, uClose: { value: 0 }, uSwing: { value: 0 }, uFar: { value: new THREE.Vector4(JX, 1.5, 0, 1) }, uFarCol: { value: new THREE.Color() }, uFarLevel: { value: 2.4 }, uNearCol: { value: new THREE.Color() } };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 160, 12), new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide,
    vertexShader: `uniform float uClose, uSwing, uTime; varying vec3 vW, vN; varying float vPh, vFog, vV;
      void main() { float u = position.x + 0.5, v = position.y + 0.5;
        float len = mix(0.5, 4.3, uClose), z = ${WALLZ.toFixed(2)} + 0.1 + u * len, amp = mix(0.13, 0.05, uClose), ph = u * 22.0 * 6.2832;
        float sway = (1.0 - v) * 0.07 * sin(uTime * 1.6 + u * 6.0) * (0.25 + uSwing) + (1.0 - v) * (1.0 - v) * uSwing * 0.25 * sin(uTime * 5.0 - u * 3.0) * u;
        float x = amp * sin(ph) * (0.6 + 0.4 * v) + sway;
        float y = mix(z > 1.63 ? -1.2 : 0.03, 3.72, v);
        vec3 p = vec3(x, y, z); vN = normalize(vec3(len, 0.0, -amp * cos(ph) * 22.0 * 6.2832 * (0.6 + 0.4 * v)));
        vW = p; vPh = ph; vV = v; vec4 mv = viewMatrix * vec4(p, 1.0); vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `${LIT}
      uniform vec4 uFar; uniform vec3 uFarCol, uNearCol; uniform float uFarLevel; varying vec3 vW, vN; varying float vPh, vFog, vV;
      void main() { vec3 V = normalize(cameraPosition - vW), N = normalize(vN); if (dot(N, V) < 0.0) N = -N;
        float weave = 0.9 + 0.1 * sin(vW.y * 420.0) * sin(vW.z * 420.0);
        vec3 alb = vec3(0.3, 0.42, 0.39) * weave * (0.75 + 0.25 * sin(vPh));
        vec3 c = labLit(N, V, alb, uNearCol * 0.5, 8.0, 0.05) + alb * uNearCol * 0.25 * exp(-pow(vW.y - 1.2, 2.0) / 3.0);
        // the jar on the far side: its glow, and the brain's shadow, soaking through the cloth
        float tt = (uFar.x - cameraPosition.x) / (vW.x - cameraPosition.x - 0.0001); vec3 hit = cameraPosition + (vW - cameraPosition) * tt;
        float mj = smoothstep(1.25, 0.7, abs(hit.z)) * smoothstep(0.0, 0.35, hit.y) * smoothstep(uFarLevel + 0.35, uFarLevel - 0.25, hit.y);
        float gg = 0.3 + 1.2 * pow(clamp(1.0 - hit.y / 2.6, 0.0, 1.0), 2.0);
        float blob = smoothstep(1.25, 0.75, length((hit.yz - uFar.yz) / vec2(0.44, 0.62)));
        blob = max(blob, smoothstep(0.1, 0.05, abs(hit.z - uFar.z + 0.1)) * smoothstep(0.9, 0.3, uFar.y - hit.y) * step(hit.y, uFar.y));
        c += uFarCol * uFar.w * mj * gg * (1.0 - 0.9 * blob) * (0.55 + 0.45 * sin(vPh + 1.0)) * 0.6;
        c += uFarCol * uFar.w * 0.05 * exp(-(pow(hit.z, 2.0) + pow(hit.y - 1.0, 2.0)) / 5.0);
        gl_FragColor = vec4(c * fogF(vFog), 1.0); }` }));
  mesh.frustumCulled = false; g.add(mesh);
  const railM = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 4.5, 8).rotateX(Math.PI / 2), dark); railM.position.set(0, 3.76, WALLZ + 2.3); g.add(railM);
  return { group: g, U };
}

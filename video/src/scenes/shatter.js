// shatter.js: the nightmare. The specimen jar marked "YOU" breaks. The only place in the video where glass shatters.
// Ported from assets/glass-shatter (fracture core copied to shatter/glasscore.js; fracture + rigid-body flight are
// precomputed per seed in shatter/sim.js and looked up by time, so every frame is a pure function of (t, shot)).
//
// Modes (shot.mode):
//   fall    the jar tips off the shelf, falls and hits the floor at lt = shot.hit (default 2.0). Slow motion after the hit.
//   burst   the jar stands still, frontal; cracks spread from 0.4 s before lt = shot.hit (default 1.0), then it explodes
//           toward the camera. shot.backdrop (engine `behind` scene) is shown behind/through the jar instead of the lab.
//   shards  aftermath loop: shards, droplets and the torn label tumbling through the dark; shot.cam 0..2; spins kick on the beat.
//   floor   still life: broken glass, the puddle and the soaked label on the tiles; slow push-in over the shot.
// shot.seed picks the fracture (fall, burst) or the arrangement (shards).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { beatAt } from '../engine.js';
import { buildModel, JAR, SHELF, S, Q } from './shatter/sim.js';

export const meta = {
  modes: ['fall', 'burst', 'shards', 'floor'],
  params: { hit: 'fall/burst: shot-local time of the impact (s); default 2.0 (fall), 1.0 (burst)', cam: 'shards: 0..2 camera variant', seed: 'fracture / arrangement variant' },
};

const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const ss = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const mix = (a, b, k) => a + (b - a) * k;
const clamp01 = x => Math.min(1, Math.max(0, x));
// cold fluorescent tube: mostly steady, with dips and the odd near-blackout
function flicker(t, depth = 1) {
  const h = hash(Math.floor(t * 30)), h2 = hash(Math.floor(t * 6) + 91.5);
  let f = 0.92 + 0.08 * Math.sin(t * 377);
  if (h2 < 0.2) f *= h < 0.5 ? 0.3 : 0.75; else if (h < 0.06) f *= 0.55;
  return 1 - depth * (1 - f);
}
const integ = (u, rate) => { const n = Math.max(1, Math.ceil(u / 0.004)), h = u / n; let s = 0.5 * (rate(0) + rate(u)); for (let i = 1; i < n; i++) s += rate(i * h); return s * h; };
const rateFall = u => u < 0.3 ? 0.05 : u < 0.6 ? mix(0.05, 0.15, ss((u - 0.3) / 0.3)) : u < 1.5 ? 0.15 : u < 3 ? mix(0.15, 0.5, ss((u - 1.5) / 1.5)) : 0.5;
const rateBurst = u => u < 0.25 ? mix(0.07, 0.15, ss(u / 0.25)) : u < 1.5 ? 0.15 : u < 3 ? mix(0.15, 0.5, ss((u - 1.5) / 1.5)) : 0.5;

const XF_W = 256;
const XF_GLSL = `
uniform sampler2D uXf; uniform float uS;
vec4 xfTexel(float id, int o) { int i = int(id + 0.5) * 2 + o; return texelFetch(uXf, ivec2(i % ${XF_W}, i / ${XF_W}), 0); }
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;
// what the glass and the wet floor reflect: ceiling tubes, cold strips of light to the sides, the green glow below
const ENV_GLSL = `
uniform float uFlick; uniform float uGreen; uniform vec3 uGreenCol; uniform vec3 uGreenPos; uniform vec3 uTubePos;
vec3 labEnv(vec3 d) {
  vec3 c = vec3(0.010, 0.014, 0.018);
  if (d.y > 0.03) {
    vec2 p = d.xz / d.y;
    float tube = smoothstep(0.20, 0.09, abs(p.x - 0.35)) * smoothstep(2.4, 1.6, abs(p.y));
    float tube2 = smoothstep(0.20, 0.09, abs(p.x + 1.3)) * smoothstep(2.4, 1.6, abs(p.y));
    c += vec3(0.80, 0.95, 1.0) * 3.2 * uFlick * (tube + 0.6 * tube2);
  }
  float az = atan(d.x, d.z);
  float fy = smoothstep(0.95, 0.15, abs(d.y));
  c += vec3(0.42, 0.60, 0.85) * 1.5 * smoothstep(0.13, 0.0, abs(abs(az) - 2.25)) * fy;
  c += vec3(0.70, 0.82, 0.90) * 1.0 * uFlick * smoothstep(0.07, 0.0, abs(az - 0.85)) * fy;
  c += vec3(0.55, 0.70, 0.85) * 0.5 * uFlick * smoothstep(0.05, 0.0, abs(az + 0.6)) * fy;
  c += uGreenCol * uGreen * 0.45 * smoothstep(0.15, -0.8, d.y);
  return c;
}
`;

export async function create({ renderer, width, height }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.02, 30);
  { const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.1; pm.dispose(); }

  const U = {
    uFlick: { value: 1 }, uGreen: { value: 1 }, uGreenCol: { value: new THREE.Color(0.5, 0.95, 0.12) }, uGreenPos: { value: new THREE.Vector3() },
    uTubePos: { value: new THREE.Vector3(0.4, 2.0, 0.7) }, uFog: { value: 0 }, uBackdrop: { value: null }, uBackOn: { value: 0 },
    uRes: { value: new THREE.Vector2(width, height) }, uPulse: { value: 0 }, uS: { value: S }, uExpo: { value: 1 }, uBody: { value: 0 },
  };

  // ------------------------------------------------------------------ lights and room
  const tubeLight = new THREE.PointLight(0xd4ecff, 10, 0, 2); tubeLight.position.copy(U.uTubePos.value); scene.add(tubeLight);
  const greenLight = new THREE.PointLight(0x9cff30, 1, 2.5, 2); scene.add(greenLight);
  const rimLight = new THREE.DirectionalLight(0x9db4d0, 0.35); rimLight.position.set(-1.5, 1.2, -1.5); scene.add(rimLight);
  const backLight = new THREE.PointLight(0x9fc4ff, 0, 0, 2); backLight.position.set(0.1, 0.35, -0.5); scene.add(backLight);
  const amb = new THREE.AmbientLight(0x8fa8b8, 0.12); scene.add(amb);

  const tileTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d');
    const N = 4, s = 1024 / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = hash(i * 7.1 + j * 13.3), v = 46 + Math.round(k * 22);
      g.fillStyle = `rgb(${v - 4},${v + 2},${v})`; g.fillRect(i * s, j * s, s, s);
      for (let m = 0; m < 60; m++) { const x = i * s + hash(m + k * 91) * s, y = j * s + hash(m * 3.3 + k * 17) * s, r = 2 + hash(m * 5.7 + k) * 26; g.fillStyle = `rgba(0,0,0,${0.03 + 0.05 * hash(m * 1.7 + k * 3)})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    }
    g.strokeStyle = '#0a0c0c'; g.lineWidth = 9;
    for (let i = 0; i <= N; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 1024); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(1024, i * s); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  })();
  const room = new THREE.Group(); scene.add(room);
  const floorMat = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.5, metalness: 0.0, envMapIntensity: 0.6 });
  tileTex.repeat.set(10, 10);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat); floor.rotation.x = -Math.PI / 2; room.add(floor);   // tiles of 0.2 m
  const wallTex = tileTex.clone(); wallTex.repeat.set(8, 3.2); wallTex.needsUpdate = true;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.2), new THREE.MeshStandardMaterial({ map: wallTex, color: 0x9aa4a6, roughness: 0.6, envMapIntensity: 0.3 }));
  wall.position.set(0, 1.6, -0.52); room.add(wall);
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a959b, roughness: 0.32, metalness: 0.9, envMapIntensity: 3.5, emissive: 0x05080a });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.4, metalness: 0.35, envMapIntensity: 3 });
  const shelfGroup = new THREE.Group(); room.add(shelfGroup);
  { const sh = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.035, 0.74), steel); sh.position.set(SHELF.xe - 1.3, SHELF.y - 0.0175, -0.15); shelfGroup.add(sh);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 0.012), steel); lip.position.set(SHELF.xe - 1.3, SHELF.y - 0.04, 0.214); shelfGroup.add(lip);
    for (const x of [-0.08, -1.2]) { const br = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.03), steel); br.position.set(SHELF.xe + x, SHELF.y - 0.24, -0.49); shelfGroup.add(br); } }
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 10), tubeMat); tube.rotation.z = Math.PI / 2; tube.position.set(-1.25, 1.62, -0.47); room.add(tube);
  const tubeBack = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.09, 0.03), dark); tubeBack.position.set(-1.25, 1.62, -0.505); room.add(tubeBack);
  // the pedestal for burst
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(JAR.Rp + 0.012, JAR.Rp + 0.03, 0.8, 40), steel); pedestal.position.set(0, -JAR.hp - 0.4, 0); scene.add(pedestal);
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshStandardMaterial({ map: wallTex, color: 0x7f8a8c, roughness: 0.6, envMapIntensity: 0.2 })); backWall.position.set(0, 0.6, -0.75); scene.add(backWall);

  // backdrop of another scene (burst)
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { uBackdrop: U.uBackdrop, uDim: { value: 0.6 } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D uBackdrop; uniform float uDim; varying vec2 vUv; void main(){ vec2 c = vUv - 0.5; gl_FragColor = vec4(texture2D(uBackdrop, vUv).rgb * uDim * (1.0 - 0.6 * dot(c, c)), 1.0); }',
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat); bg.frustumCulled = false; bg.renderOrder = -100; scene.add(bg);

  // ------------------------------------------------------------------ the label
  const labelCanvas = (torn) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 520; const g = c.getContext('2d');
    g.fillStyle = '#d8d0b4'; g.fillRect(0, 0, 900, 520);
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${90 + hash(i) * 60},${80 + hash(i + .3) * 40},40,${0.02 + 0.05 * hash(i * 3.1)})`; g.beginPath(); g.arc(hash(i * 1.3) * 900, hash(i * 2.7) * 520, 4 + hash(i * 5.3) * 46, 0, 7); g.fill(); }
    g.strokeStyle = '#6e1410'; g.lineWidth = 12; g.strokeRect(22, 22, 856, 476); g.lineWidth = 3; g.strokeRect(40, 40, 820, 440);
    g.fillStyle = '#3a2f28'; g.font = '700 40px "IBM Plex Mono"'; g.textBaseline = 'alphabetic';
    g.fillText('SPECIMEN', 66, 100); g.textAlign = 'right'; g.fillText('No. 02', 834, 100); g.textAlign = 'left';
    g.fillRect(66, 116, 768, 4);
    g.font = '400 26px "IBM Plex Mono"'; g.fillStyle = '#5a4c40'; g.fillText('SUBJECT', 66, 156);
    g.fillRect(66, 452, 768, 3);
    g.save(); g.translate(450, 330); g.rotate(-0.045); g.textAlign = 'center';
    g.font = '700 330px "Caveat"'; g.fillStyle = '#0d0f1c';
    g.fillText('YOU', 0, 96); g.globalAlpha = 0.6; g.fillText('YOU', 3, 98); g.restore();
    if (torn) {
      // soaked: green-brown stains, then tear the edges away
      for (let i = 0; i < 26; i++) { const x = hash(i * 9.1) * 900, y = hash(i * 4.3) * 520, r = 50 + hash(i * 7.7) * 170; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,95,10,0.17)'); gr.addColorStop(1, 'rgba(70,95,10,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000';
      const rip = (pts) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); };
      const edge = []; for (let i = 0; i <= 40; i++) edge.push([790 + 70 * hash(i * 1.9) - 60 * (i / 40) + (i % 2) * 18, i * 13]);
      rip([...edge, [900, 520], [900, 0]]);
      const e2 = []; for (let i = 0; i <= 30; i++) e2.push([i * 12, 430 + 50 * hash(i * 3.7) + i * 1.5]);
      rip([...e2, [360, 520], [0, 520]]);
      const e3 = []; for (let i = 0; i <= 20; i++) e3.push([i * 9, 46 * hash(i * 2.3) + 20 - i]);
      rip([[0, 0], ...e3, [180, 0]]);
      g.globalCompositeOperation = 'source-over';
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  };
  const labelTex = labelCanvas(false), tornTex = labelCanvas(true);

  // free paper (shards: fluttering; floor: lying in the puddle)
  const paperMat = (flutter) => new THREE.ShaderMaterial({
    uniforms: { ...U, uMap: { value: tornTex }, uT: { value: 0 }, uAmp: { value: flutter }, uWet: { value: 0 } },
    side: THREE.DoubleSide, transparent: false,
    vertexShader: `uniform float uT; uniform float uAmp; varying vec2 vUv; varying vec3 vW;
      void main(){ vUv = uv; vec3 p = position; float x = p.x * 6.0, y = p.y * 6.0;
        p.z += uAmp * ((sin(x * 2.3 + uT * 3.1) * 0.35 + sin(y * 3.1 - uT * 2.3 + x * 0.8) * 0.25) * (0.35 + uv.x) + 0.9 * p.x * p.x * sin(uT * 0.9) * 6.0 + 0.5 * p.y * p.x * cos(uT * 1.3) * 8.0) * 0.03;
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: ENV_GLSL + `uniform sampler2D uMap; uniform float uWet; uniform float uFog; uniform float uPulse; varying vec2 vUv; varying vec3 vW;
      void main(){ vec4 t = texture2D(uMap, vUv); if (t.a < 0.5) discard;
        vec3 N = normalize(cross(dFdx(vW), dFdy(vW)));
        vec3 V = normalize(cameraPosition - vW); if (dot(N, V) < 0.0) N = -N;
        vec3 Lt = uTubePos - vW; float dt = length(Lt); Lt /= dt;
        vec3 Lg = uGreenPos - vW; float dg = length(Lg); Lg /= dg;
        vec3 lit = vec3(0.80, 0.92, 1.0) * uFlick * (0.3 + 0.7 * abs(dot(N, Lt))) * 1.1 + vec3(0.8, 0.9, 1.0) * 0.55 * abs(dot(N, V)) * (0.5 + 0.5 * uFlick) + uGreenCol * uGreen * (0.35 + 0.65 * abs(dot(N, Lg))) * 0.35 / (0.3 + dg * dg) * 0.3 + 0.03;
        vec3 col = t.rgb * lit;
        col = mix(col, col * vec3(0.45, 0.62, 0.22) + uGreenCol * 0.05 * uGreen, uWet);
        float sp = pow(max(dot(reflect(-V, N), Lt), 0.0), 40.0); col += uWet * sp * 0.5 * uFlick;
        col *= exp(-max(length(cameraPosition - vW) - 0.7, 0.0) * uFog);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const paperFly = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.208, 36, 20), paperMat(1)); scene.add(paperFly);
  const paperFloor = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.136, 2, 2), paperMat(0)); paperFloor.material.uniforms.uWet.value = 0.4; scene.add(paperFloor);

  // ------------------------------------------------------------------ materials that follow the pieces
  const glassMat = (xf) => new THREE.ShaderMaterial({
    uniforms: { ...U, uXf: { value: xf } },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    vertexShader: XF_GLSL + `attribute float piece; attribute float kind;
      varying vec3 vW; varying vec3 vN; varying float vKind; varying float vGlow;
      void main(){ vec4 a = xfTexel(piece, 0), q = xfTexel(piece, 1);
        vW = a.xyz + qrot(q, position * uS); vN = qrot(q, normal); vKind = kind; vGlow = a.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: ENV_GLSL + `uniform float uFog; uniform float uPulse; uniform float uBackOn; uniform sampler2D uBackdrop; uniform vec2 uRes; uniform float uExpo; uniform float uBody;
      varying vec3 vW; varying vec3 vN; varying float vKind; varying float vGlow;
      void main(){
        vec3 N = normalize(vN); vec3 Vv = cameraPosition - vW; float dist = length(Vv); vec3 V = Vv / dist;
        if (dot(N, V) < 0.0) N = -N;
        float ndv = dot(N, V), fres = pow(1.0 - ndv, 2.5);
        vec3 R = reflect(-V, N);
        vec3 env = labEnv(R);
        float isEdge = step(1.5, vKind) * step(vKind, 2.5), on = mix(1.0, vGlow, isEdge);
        vec3 col = env * (0.18 + 0.82 * fres) * 1.3;
        col += vec3(0.50, 0.75, 1.0) * (0.45 * pow(fres, 1.3) + 0.012) * (0.4 + 0.6 * uFlick);
        vec3 Lg = uGreenPos - vW; float dg = length(Lg); Lg /= dg;
        col += uGreenCol * uGreen * (pow(max(dot(R, Lg), 0.0), 20.0) * 1.6 + 0.30 * fres) / (1.0 + dg * dg * 5.0);
        vec3 Lt = normalize(uTubePos - vW);
        col += vec3(0.85, 0.95, 1.0) * uFlick * pow(max(dot(R, Lt), 0.0), 120.0) * 4.0;
        // loose shards in the dark: broad sheen on the faces as they turn
        col += uBody * (vec3(0.30, 0.46, 0.50) * (0.05 + 0.9 * pow(max(dot(R, Lt), 0.0), 5.0) * uFlick) + uGreenCol * uGreen * 0.5 * pow(max(dot(R, Lg), 0.0), 6.0));
        // fracture faces: the thick green edge of the glass, catching the light
        float e = step(1.5, vKind);
        col += e * (vec3(0.24, 0.50, 0.46) * (0.55 + 0.45 * uFlick) + uGreenCol * uGreen * 0.25 / (1.0 + dg * dg * 5.0) + env * 0.5 + vec3(0.9, 1.0, 0.95) * pow(max(dot(R, Lt), 0.0), 12.0) * 0.9 * uFlick) * (1.0 + 1.5 * uPulse);
        col *= on * uExpo;
        col *= exp(-max(dist - 0.7, 0.0) * uFog);
        float a = 0.0;
        if (uBackOn > 0.5) { // the picture behind, bent by the glass
          vec3 nv = mat3(viewMatrix) * N;
          vec2 uv = gl_FragCoord.xy / uRes + nv.xy * (0.05 + 0.08 * e);
          a = on * (0.30 + 0.5 * fres);
          col += a * texture2D(uBackdrop, uv).rgb * vec3(0.55, 0.75, 0.62);
        }
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
  });
  const labelMat = (xf) => new THREE.ShaderMaterial({
    uniforms: { ...U, uXf: { value: xf }, uMap: { value: labelTex } }, side: THREE.DoubleSide,
    vertexShader: XF_GLSL + `attribute float piece; attribute vec2 luv; varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){ vec4 a = xfTexel(piece, 0), q = xfTexel(piece, 1);
        vN = qrot(q, normal); vW = a.xyz + qrot(q, position * uS) + vN * 0.0006; vUv = luv;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: ENV_GLSL + `uniform sampler2D uMap; uniform float uFog; varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){ if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) discard;
        vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
        float back = step(dot(N, V), 0.0);
        vec3 Lt = uTubePos - vW; Lt = normalize(Lt);
        vec3 Lg = uGreenPos - vW; float dg = length(Lg); Lg /= dg;
        vec3 lit = vec3(0.80, 0.92, 1.0) * uFlick * (0.3 + 0.7 * max(dot(N, Lt), 0.0)) * 0.8 + uGreenCol * uGreen * 0.12 / (0.25 + dg * dg) + 0.035;
        vec3 paper = mix(texture2D(uMap, vUv).rgb, vec3(0.50, 0.47, 0.36), back);
        vec3 col = paper * mix(lit, vec3(0.80, 0.92, 1.0) * uFlick * 0.12 + uGreenCol * uGreen * 0.25 / (0.25 + dg * dg), back);
        col *= exp(-max(length(cameraPosition - vW) - 0.7, 0.0) * uFog);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const crackMat = (xf) => new THREE.ShaderMaterial({
    uniforms: { ...U, uXf: { value: xf }, uCrackT: { value: 0 }, uOn: { value: 1 }, uWidth: { value: 3.2 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: XF_GLSL + `attribute float piece; attribute vec3 other; attribute vec3 info; uniform vec2 uRes; uniform float uWidth;
      varying float vT; varying float vInner; varying float vSide;
      void main(){ vec4 a = xfTexel(piece, 0), q = xfTexel(piece, 1);
        vec4 c0 = projectionMatrix * viewMatrix * vec4(a.xyz + qrot(q, position * uS), 1.0);
        vec4 c1 = projectionMatrix * viewMatrix * vec4(a.xyz + qrot(q, other * uS), 1.0);
        vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * uRes; float l = length(d); d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
        vec2 nrm = vec2(-d.y, d.x);
        vT = info.x; vInner = info.y; vSide = info.z;
        c0.xy += nrm * info.z * uWidth / uRes * c0.w;
        gl_Position = c0; }`,
    fragmentShader: `uniform float uCrackT; uniform float uOn; uniform float uFlick; varying float vT; varying float vInner; varying float vSide;
      void main(){ if (vT > uCrackT) discard;
        float fresh = exp(-(uCrackT - vT) / 0.10);
        float w = 1.0 - vSide * vSide;
        float a = uOn * w * (0.30 + 0.25 * uFlick + 2.6 * fresh) * mix(1.0, 0.7, vInner);
        gl_FragColor = vec4(mix(vec3(0.55, 0.95, 0.78), vec3(1.0), fresh) * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // the fluid before it breaks out: a lit volume (ray through a cylinder cut by the tilted fluid surface)
  const makeVol = () => new THREE.ShaderMaterial({
    uniforms: { ...U, uPlane: { value: new THREE.Vector4(0, 1, 0, JAR.fill) }, uDim: { value: new THREE.Vector3(JAR.R - JAR.wall * 0.6, JAR.y0, JAR.H) }, uT: { value: 0 } },
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `varying vec3 vL; varying vec3 vC; void main(){ vL = position; vC = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec4 uPlane; uniform vec3 uDim; uniform vec3 uGreenCol; uniform float uGreen; uniform float uFlick; uniform float uT; varying vec3 vL; varying vec3 vC;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      void main(){ vec3 ro = vC, rd = normalize(vL - vC);
        float a = dot(rd.xz, rd.xz), b = dot(ro.xz, rd.xz), c = dot(ro.xz, ro.xz) - uDim.x * uDim.x;
        float disc = b * b - a * c; if (disc < 0.0 || a < 1e-9) discard;
        float sq = sqrt(disc), t0 = (-b - sq) / a, t1 = (-b + sq) / a;
        if (abs(rd.y) > 1e-6) { float ya = (uDim.y - ro.y) / rd.y, yb = (uDim.z - ro.y) / rd.y; t0 = max(t0, min(ya, yb)); t1 = min(t1, max(ya, yb)); }
        float nd = dot(uPlane.xyz, rd), no = uPlane.w - dot(uPlane.xyz, ro); float top = 0.0;
        if (nd > 1e-6) { t1 = min(t1, no / nd); } else if (nd < -1e-6) { float tp = no / nd; if (tp > t0) { t0 = tp; top = 1.0; } } else if (no < 0.0) discard;
        t0 = max(t0, 0.0); float len = t1 - t0; if (len <= 0.0) discard;
        vec3 mid = ro + rd * (t0 + 0.35 * len);
        float hgt = clamp((mid.y - uDim.y) / (uPlane.w - uDim.y), 0.0, 1.0);
        float glow = mix(1.9, 0.38, pow(hgt, 0.7));
        // slow murk and a few bubbles
        vec3 pe = ro + rd * t0; float ang = atan(pe.z, pe.x);
        glow *= 0.86 + 0.14 * sin(ang * 5.0 + pe.y * 23.0 + uT * 0.7) * sin(pe.y * 31.0 - uT * 0.9);
        vec2 bc = vec2(ang * 5.0, pe.y * 26.0 - uT * 1.6); vec2 bi = floor(bc), bf = fract(bc) - 0.5;
        float bub = step(0.86, h21(bi)) * smoothstep(0.16, 0.05, length(bf + 0.25 * (vec2(h21(bi + 3.1), h21(bi + 7.7)) - 0.5)));
        float al = 1.0 - exp(-len * 16.0);
        vec3 col = uGreenCol * vec3(1.0, 0.95, 0.8) * glow * uGreen * 0.62 + vec3(0.9, 1.0, 0.7) * bub * 0.5;
        col += vec3(0.75, 1.0, 0.6) * top * 0.22 * (0.5 + 0.5 * uFlick);
        gl_FragColor = vec4(col * al, al * 0.82);
        #include <colorspace_fragment>
      }`,
  });
  const volMat = makeVol();
  const vol = new THREE.Mesh(new THREE.CylinderGeometry(JAR.R, JAR.R, JAR.H, 40, 1), volMat); vol.geometry.translate(0, JAR.H / 2, 0); vol.renderOrder = 1; scene.add(vol);

  const DROP_FRAG = `uniform vec3 uGreenCol; uniform float uGreen; uniform float uFlick; uniform float uGlow; varying vec2 vUv; varying float vA; varying float vFog;
    void main(){ float r2 = dot(vUv, vUv); if (r2 > 1.0) discard;
      float body = exp(-r2 * 2.6) * (1.0 - r2);
      float a = clamp(body * 1.3, 0.0, 1.0) * vA;
      vec3 col = uGreenCol * (0.30 + 0.75 * body * body) * uGlow;
      col += vec3(0.8, 1.0, 0.9) * smoothstep(0.22, 0.0, length(vUv - vec2(-0.28, 0.34))) * 0.9 * (0.3 + 0.7 * uFlick) * step(0.6, vA);
      gl_FragColor = vec4(col * a * vFog, a * vFog);
      #include <colorspace_fragment>
    }`;
  const dropBlend = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };
  const quad = () => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return g; };
  const dropMat = () => new THREE.ShaderMaterial({
    uniforms: { ...U, uTau: { value: 0 }, uFloor: { value: 0 }, uGlow: { value: 1 }, uStretch: { value: 0.012 } }, ...dropBlend,
    vertexShader: `attribute vec3 iP; attribute vec3 iV; attribute vec4 iA; attribute vec3 iS; uniform float uTau; uniform float uFloor; uniform float uStretch;
      varying vec2 vUv; varying float vA; varying float vFog;
      void main(){ float t = uTau - iA.y; vec3 p; vec3 vel; float size = iA.z; float al = 1.0; const float G = 9.81;
        if (t < iA.x) { float s = max(t, 0.0); p = iP + iV * s + vec3(0.0, -0.5 * G * s * s, 0.0); vel = iV + vec3(0.0, -G * s, 0.0); size *= 1.0 + 0.5 * smoothstep(0.0, 0.15, s) * iA.w; }
        else { float s = t - iA.x, tl = iA.x; vec3 pl = iP + iV * tl + vec3(0.0, -0.5 * G * tl * tl, 0.0); float e = (1.0 - exp(-5.0 * s)) / 5.0;
          p = pl + vec3(iS.x, 0.0, iS.y) * e; p.y = uFloor + 0.004 + 0.3 * size; vel = vec3(iS.x, 0.0, iS.y) * exp(-5.0 * s);
          size *= mix(1.25, 0.8, smoothstep(0.0, 0.5, s)); al = mix(0.9, 0.0, smoothstep(0.0, 0.6, s)); }
        if (t < 0.0) al = 0.0;
        al *= iS.z;
        vec4 c = viewMatrix * vec4(p, 1.0); vec3 vv = mat3(viewMatrix) * vel; float sp = length(vv.xy);
        vec2 ax = sp > 1e-4 ? vv.xy / sp : vec2(1.0, 0.0);
        float len = size * (1.0 + min(sp * uStretch / size, 3.0));
        c.xy += ax * position.x * len + vec2(-ax.y, ax.x) * position.y * size;
        al *= mix(0.2, 1.0, smoothstep(0.08, 0.5, -c.z));
        vUv = position.xy; vA = al; vFog = 1.0;
        gl_Position = projectionMatrix * c; }`,
    fragmentShader: DROP_FRAG,
  });
  // droplets for the shards loop: drifting along a direction, wrapping around
  const NDRIFT = 520;
  const driftMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uT: { value: 0 }, uC: { value: new THREE.Vector3() }, uRt: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uFl: { value: new THREE.Vector3(0, 0, 1) }, uRange: { value: new THREE.Vector2(-3, 1.3) }, uGlow: { value: 1 } }, ...dropBlend,
    vertexShader: `attribute vec4 iA; attribute vec4 iB; uniform float uT; uniform vec3 uC; uniform vec3 uRt; uniform vec3 uUp; uniform vec3 uFl; uniform vec2 uRange; uniform float uFog; uniform float uPulse;
      varying vec2 vUv; varying float vA; varying float vFog;
      void main(){ float L = uRange.y - uRange.x; float s = uRange.x + mod(iA.z * L + iB.x * uT, L);
        vec3 p = uC + uRt * (iA.x + 0.03 * sin(uT * iB.z + iA.w * 40.0)) + uUp * (iA.y + 0.03 * sin(uT * iB.z * 0.8 + iA.w * 17.0)) + uFl * s;
        float size = iB.y * (1.0 + 0.25 * sin(uT * 2.0 + iA.w * 60.0) + 0.3 * uPulse);
        vec4 c = viewMatrix * vec4(p, 1.0);
        c.xy += position.xy * size * vec2(1.0, 1.0 + 0.35 * sin(uT * 1.7 + iA.w * 30.0));
        vUv = position.xy; vA = 0.9; vFog = exp(-max(-c.z - 0.7, 0.0) * uFog) * smoothstep(0.03, 0.14, -c.z);
        gl_Position = projectionMatrix * c; }`,
    fragmentShader: DROP_FRAG,
  });
  const drift = (() => {
    const g = quad(), A = new Float32Array(NDRIFT * 4), Bv = new Float32Array(NDRIFT * 4);
    for (let i = 0; i < NDRIFT; i++) { A.set([(hash(i * 1.1) * 2 - 1) * 1.5, (hash(i * 2.3 + 5) * 2 - 1) * 0.9, hash(i * 3.7 + 9), hash(i * 5.1 + 2)], i * 4); const b = hash(i * 7.3 + 1); Bv.set([0.10 + 0.28 * hash(i * 9.7 + 4), 0.004 + 0.012 * b * b + (b > 0.95 ? 0.016 : 0), 0.6 + hash(i * 4.9), 0], i * 4); }
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4)); g.setAttribute('iB', new THREE.InstancedBufferAttribute(Bv, 4)); g.instanceCount = NDRIFT;
    const m = new THREE.Mesh(g, driftMat); m.frustumCulled = false; m.renderOrder = 1; scene.add(m); return m;
  })();

  // the puddle
  const puddleMat = new THREE.ShaderMaterial({
    uniforms: { ...U, uR: { value: 0 }, uC: { value: new THREE.Vector2() }, uT: { value: 0 } }, transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: ENV_GLSL + `uniform float uR; uniform vec2 uC; uniform float uT; varying vec3 vW;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main(){ vec2 p = vW.xz - uC; p.x *= 0.8;
        float d = length(p) + (vn(p * 5.0 + 3.0) - 0.5) * 0.30 + (vn(p * 14.0) - 0.5) * 0.09 + (vn(p * 40.0) - 0.5) * 0.02;
        // splashes thrown further out
        float sp = smoothstep(0.80, 0.86, vn(p * 23.0 + 11.0)) * smoothstep(uR * 1.9 + 0.02, uR * 1.2, length(p));
        float inside = max(smoothstep(uR, uR - 0.025, d), sp * step(0.02, uR));
        if (inside < 0.01) discard;
        float rim = smoothstep(uR - 0.05, uR - 0.01, d) * (1.0 - sp);
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vec3((vn(p * 30.0 + uT * 0.25) - 0.5) * 0.02, 1.0, (vn(p * 30.0 + 7.0 - uT * 0.2) - 0.5) * 0.02));
        float fr = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 col = uGreenCol * uGreen * (0.16 + 0.10 * vn(p * 9.0 + 1.0) + 0.12 * rim) + labEnv(reflect(-V, N)) * fr * 0.9;
        gl_FragColor = vec4(col, inside * 0.9);
        #include <colorspace_fragment>
      }`,
  });
  const puddle = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), puddleMat); puddle.rotation.x = -Math.PI / 2; puddle.position.y = 0.0015; puddle.renderOrder = 0; scene.add(puddle);

  // lid, plinth, wires
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(JAR.Rl, JAR.Rl, JAR.hl, 48), dark); scene.add(lid);
  { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.026, 0.014, 20), steel); cap.position.y = JAR.hl / 2 + 0.007; lid.add(cap); }
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(JAR.Rp - 0.004, JAR.Rp, JAR.hp, 48), dark); scene.add(plinth);
  { const ring = new THREE.Mesh(new THREE.CylinderGeometry(JAR.Rp - 0.002, JAR.Rp - 0.002, 0.004, 48), steel); ring.position.y = JAR.hp / 2 - 0.004; plinth.add(ring); }
  // the other jar, left standing on the shelf (fall): no label, the same sick fluid
  const jar2 = new THREE.Group(); scene.add(jar2);
  {
    const Bx = SHELF.xe - 0.50, By = SHELF.y + JAR.hp, Bz = -0.06;
    const xf2 = new THREE.DataTexture(new Float32Array([Bx, By, Bz, 1, 0, 0, 0, 1, ...new Array((XF_W - 2) * 4).fill(0)]), XF_W, 1, THREE.RGBAFormat, THREE.FloatType); xf2.minFilter = xf2.magFilter = THREE.NearestFilter; xf2.needsUpdate = true;
    const g2 = new THREE.CylinderGeometry(JAR.R / S, JAR.R / S, JAR.H / S, 56, 1, true); g2.translate(0, JAR.H / S / 2, 0);
    const m2 = glassMat(xf2); m2.side = THREE.DoubleSide;
    const gl2 = new THREE.Mesh(g2, m2); gl2.frustumCulled = false; gl2.renderOrder = 3;
    const v2 = new THREE.Mesh(vol.geometry, makeVol()); v2.position.set(Bx, By, Bz); v2.renderOrder = 1;
    const l2 = new THREE.Mesh(lid.geometry, dark); l2.position.set(Bx, By + JAR.H + JAR.hl / 2 - 0.004, Bz);
    const p2 = new THREE.Mesh(plinth.geometry, dark); p2.position.set(Bx, By - JAR.hp / 2, Bz);
    jar2.add(l2, p2, v2, gl2);
  }
  const NW = 3, WSEG = 44, WRAD = 6;
  const wires = [];
  for (let k = 0; k < NW; k++) {
    const g = new THREE.BufferGeometry(), nv = (WSEG + 1) * WRAD, idx = [];
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    for (let i = 0; i < WSEG; i++) for (let j = 0; j < WRAD; j++) { const a = i * WRAD + j, b = i * WRAD + (j + 1) % WRAD, c = a + WRAD, d = b + WRAD; idx.push(a, c, b, b, c, d); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: [0x8c1c14, 0x23272a, 0x9a8420][k], roughness: 0.45, metalness: 0.1, envMapIntensity: 2 })); m.frustumCulled = false; scene.add(m);
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, color: 0xbfe0ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); scene.add(spark);
    wires.push({ mesh: m, spark, local: [[-0.034, 0.012], [0.03, -0.02], [0.004, 0.036]][k] });
  }
  { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, 'rgba(200,225,255,.7)'); gr.addColorStop(1, 'rgba(120,170,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); for (const w of wires) w.spark.material.map = t; }
  const _p = new THREE.Vector3(), _tn = new THREE.Vector3(), _n1 = new THREE.Vector3(), _n2 = new THREE.Vector3(), _prev = new THREE.Vector3(), _ref = new THREE.Vector3();
  function setWire(w, fn, radius = 0.0045) {
    const pos = w.mesh.geometry.attributes.position.array, nor = w.mesh.geometry.attributes.normal.array, pts = [];
    for (let i = 0; i <= WSEG; i++) pts.push(fn(i / WSEG));
    for (let i = 0; i <= WSEG; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(WSEG, i + 1)];
      _tn.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      _ref.set(0, 0, 1); if (Math.abs(_tn.z) > 0.9) _ref.set(1, 0, 0);
      _n1.crossVectors(_tn, _ref).normalize(); _n2.crossVectors(_tn, _n1);
      for (let j = 0; j < WRAD; j++) { const an = j / WRAD * 6.2832, cx = Math.cos(an), sx = Math.sin(an), o = (i * WRAD + j) * 3;
        const nx = _n1.x * cx + _n2.x * sx, ny = _n1.y * cx + _n2.y * sx, nz = _n1.z * cx + _n2.z * sx;
        pos[o] = pts[i][0] + nx * radius; pos[o + 1] = pts[i][1] + ny * radius; pos[o + 2] = pts[i][2] + nz * radius; nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz; }
    }
    w.mesh.geometry.attributes.position.needsUpdate = true; w.mesh.geometry.attributes.normal.needsUpdate = true;
    return pts[WSEG];
  }

  // ------------------------------------------------------------------ models (lazy, cached per kind and seed)
  const models = new Map();
  function getModel(kind, seed) {
    const key = kind + ':' + seed;
    let M = models.get(key);
    if (M) return M;
    M = buildModel(kind, seed);
    const n = M.n, h = Math.max(1, Math.ceil(2 * n / XF_W));
    M.xfData = new Float32Array(XF_W * h * 4);
    M.xf = new THREE.DataTexture(M.xfData, XF_W, h, THREE.RGBAFormat, THREE.FloatType); M.xf.minFilter = M.xf.magFilter = THREE.NearestFilter; M.xf.needsUpdate = true;
    const mesh = M.mesh, nv = mesh.vertexCount;
    // label coordinates on the outer surface
    const luv = new Float32Array(nv * 2).fill(-1), inLab = new Uint8Array(nv), pieces = M.res.pieces;
    for (let i = 0; i < nv; i++) {
      if (mesh.kind[i] !== 0) continue;
      const c = pieces[mesh.piece[i]].com, x = mesh.position[i * 3] + c[0], y = (mesh.position[i * 3 + 1] + c[1]) * S, z = mesh.position[i * 3 + 2] + c[2];
      let dp = Math.atan2(z, x) - JAR.labelPhi; dp -= 2 * Math.PI * Math.round(dp / (2 * Math.PI));
      const u = 0.5 - dp / JAR.labelDphi, v = (y - JAR.labelY0) / (JAR.labelY1 - JAR.labelY0);
      if (Math.abs(dp) < 1.6) { luv[i * 2] = u; luv[i * 2 + 1] = v; if (u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05) inLab[i] = 1; }
    }
    const lidx = [];
    for (let t = 0; t < mesh.index.length; t += 3) { const a = mesh.index[t], b = mesh.index[t + 1], c = mesh.index[t + 2]; if (inLab[a] && inLab[b] && inLab[c]) lidx.push(a, b, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
    g.setAttribute('piece', new THREE.BufferAttribute(mesh.piece, 1)); g.setAttribute('kind', new THREE.BufferAttribute(mesh.kind, 1));
    g.setIndex(new THREE.BufferAttribute(mesh.index, 1));
    M.glass = new THREE.Mesh(g, glassMat(M.xf)); M.glass.frustumCulled = false; M.glass.renderOrder = 3;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', g.attributes.position); lg.setAttribute('normal', g.attributes.normal); lg.setAttribute('piece', g.attributes.piece);
    lg.setAttribute('luv', new THREE.BufferAttribute(luv, 2)); lg.setIndex(lidx);
    M.label = new THREE.Mesh(lg, labelMat(M.xf)); M.label.frustumCulled = false;
    // cracks as screen-space ribbons
    const L = M.lines, ns = L.time.length / 2, cp = new Float32Array(ns * 12), co = new Float32Array(ns * 12), cpi = new Float32Array(ns * 4), ci = new Float32Array(ns * 12), cidx = new Uint32Array(ns * 6);
    for (let s = 0; s < ns; s++) {
      const a = s * 6, b = a + 3;
      for (let k = 0; k < 4; k++) {
        const me = k < 2 ? a : b, ot = k < 2 ? b : a, o = (s * 4 + k) * 3;
        cp[o] = L.position[me]; cp[o + 1] = L.position[me + 1]; cp[o + 2] = L.position[me + 2];
        co[o] = L.position[ot]; co[o + 1] = L.position[ot + 1]; co[o + 2] = L.position[ot + 2];
        cpi[s * 4 + k] = L.piece[s * 2];
        ci[o] = L.time[s * 2 + (k < 2 ? 0 : 1)] / M.T0; ci[o + 1] = L.inner[s * 2]; ci[o + 2] = [1, -1, -1, 1][k];
      }
      cidx.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 1, s * 4 + 3, s * 4 + 2], s * 6);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(cp, 3)); cg.setAttribute('other', new THREE.BufferAttribute(co, 3)); cg.setAttribute('piece', new THREE.BufferAttribute(cpi, 1)); cg.setAttribute('info', new THREE.BufferAttribute(ci, 3));
    cg.setIndex(new THREE.BufferAttribute(cidx, 1));
    M.cracks = new THREE.Mesh(cg, crackMat(M.xf)); M.cracks.frustumCulled = false; M.cracks.renderOrder = 4;
    // fluid
    const fg = quad(), F = M.fluid;
    fg.setAttribute('iP', new THREE.InstancedBufferAttribute(F.P, 3)); fg.setAttribute('iV', new THREE.InstancedBufferAttribute(F.V, 3)); fg.setAttribute('iA', new THREE.InstancedBufferAttribute(F.A, 4)); fg.setAttribute('iS', new THREE.InstancedBufferAttribute(F.S, 3));
    fg.instanceCount = F.n;
    M.drops = new THREE.Mesh(fg, dropMat()); M.drops.frustumCulled = false; M.drops.renderOrder = 2;
    M.drops.material.uniforms.uFloor.value = M.floorY;
    M.group = new THREE.Group(); M.group.add(M.label, M.drops, M.glass, M.cracks); scene.add(M.group);
    // the big pieces, for the shards loop
    M.bySize = [...pieces.keys()].sort((a, b) => pieces[b].cells - pieces[a].cells);
    // wires: where they are fixed, and when they pull out of the lid
    M.wire = wires.map((w, k) => {
      const A = kind === 'fall' ? [SHELF.xe - 0.42 + 0.13 * k, 1.42 + 0.05 * k, -0.42] : [-0.28 + 0.3 * k + (k === 1 ? 0.1 : 0), 0.95, -0.25 - 0.1 * k];
      const loc = [w.local[0], JAR.H + JAR.hl - 0.004, w.local[1]], len = kind === 'fall' ? 0.86 + 0.06 * k : 0;
      let snap = 0;
      if (kind === 'fall') { // the moment the wire is pulled tight
        snap = 0; for (let tau = -M.traj.tFall; tau < 0; tau += 0.002) { const p = jarPoint(M, tau, loc); if (Math.hypot(p[0] - A[0], p[1] - A[1], p[2] - A[2]) >= len) { snap = tau; break; } }
      }
      const ps = jarPoint(M, snap, loc), L3 = Math.hypot(ps[0] - A[0], ps[1] - A[1], ps[2] - A[2]);
      return { A, loc, len: kind === 'fall' ? len : L3, snap, ps };
    });
    models.set(key, M);
    return M;
  }
  function jarPose(M, tau) { // base centre and quaternion of the whole jar before the hit
    if (M.kind === 'fall') { const p = M.traj.at(Math.min(tau, 0)); return { B: p.B, q: [0, 0, Math.sin(-p.th / 2), Math.cos(-p.th / 2)], th: p.th }; }
    return { B: M.B, q: M.qJ, th: 0 };
  }
  function jarPoint(M, tau, loc) { const P = jarPose(M, tau), r = Q.qrot(P.q, loc); return [P.B[0] + r[0], P.B[1] + r[1], P.B[2] + r[2]]; }

  // poses of all pieces, lid and plinth at simulation time tau (0 = the hit); cp = crack progress 0..1
  function pose(M, tau, cp) {
    const X = M.xfData, n = M.n, cs = M.comS;
    if (tau <= 0) {
      const P = jarPose(M, tau), q = P.q, B = P.B;
      for (let i = 0; i < n; i++) {
        const r = Q.qrot(q, [cs[i * 3], cs[i * 3 + 1], cs[i * 3 + 2]]), o = i * 8;
        X[o] = B[0] + r[0]; X[o + 1] = B[1] + r[1]; X[o + 2] = B[2] + r[2]; X[o + 3] = clamp01((cp * 1.06 - M.tRel[i]) / 0.06);
        X[o + 4] = q[0]; X[o + 5] = q[1]; X[o + 6] = q[2]; X[o + 7] = q[3];
      }
      const lp = Q.qrot(q, [0, JAR.H + JAR.hl / 2 - 0.004, 0]), pp = Q.qrot(q, [0, -JAR.hp / 2, 0]);
      lid.position.set(B[0] + lp[0], B[1] + lp[1], B[2] + lp[2]); lid.quaternion.set(q[0], q[1], q[2], q[3]);
      plinth.position.set(B[0] + pp[0], B[1] + pp[1], B[2] + pp[2]); plinth.quaternion.set(q[0], q[1], q[2], q[3]);
    } else {
      const R = M.rec, f = Math.min(tau / R.fdt, R.nF - 1), f0 = Math.min(Math.floor(f), R.nF - 2), k = f - f0, F = R.frames, nb = R.nb;
      const body = (bi, out, o) => {
        const a = (f0 * nb + bi) * 7, b = a + nb * 7;
        out[o] = F[a] + k * (F[b] - F[a]); out[o + 1] = F[a + 1] + k * (F[b + 1] - F[a + 1]); out[o + 2] = F[a + 2] + k * (F[b + 2] - F[a + 2]);
        const s = F[a + 3] * F[b + 3] + F[a + 4] * F[b + 4] + F[a + 5] * F[b + 5] + F[a + 6] * F[b + 6] < 0 ? -1 : 1;
        const x = F[a + 3] + k * (s * F[b + 3] - F[a + 3]), y = F[a + 4] + k * (s * F[b + 4] - F[a + 4]), z = F[a + 5] + k * (s * F[b + 5] - F[a + 5]), w = F[a + 6] + k * (s * F[b + 6] - F[a + 6]), l = Math.hypot(x, y, z, w) || 1;
        out[o + 4] = x / l; out[o + 5] = y / l; out[o + 6] = z / l; out[o + 7] = w / l;
      };
      const bp = M.bodyPieces;
      for (let bi = 0; bi < bp.length; bi++) { const o = bp[bi] * 8; body(bi, X, o); X[o + 3] = clamp01((cp * 1.06 - M.tRel[bp[bi]]) / 0.06); }
      for (const d of M.dust) {
        const o = d.q * 8, t = Math.min(tau, d.tl);
        X[o] = d.x[0] + d.v[0] * t; X[o + 1] = d.x[1] + d.v[1] * t - 4.905 * t * t; X[o + 2] = d.x[2] + d.v[2] * t; X[o + 3] = clamp01((cp * 1.06 - M.tRel[d.q]) / 0.06);
        const q = Q.qmul(Q.qAxis(d.ax, d.wl * t), M.qJ); X[o + 4] = q[0]; X[o + 5] = q[1]; X[o + 6] = q[2]; X[o + 7] = q[3];
      }
      const tmp = new Float32Array(8);
      body(M.iLid, tmp, 0); lid.position.set(tmp[0], tmp[1], tmp[2]); lid.quaternion.set(tmp[4], tmp[5], tmp[6], tmp[7]);
      body(M.iPlinth, tmp, 0); plinth.position.set(tmp[0], tmp[1], tmp[2]); plinth.quaternion.set(tmp[4], tmp[5], tmp[6], tmp[7]);
    }
    M.xf.needsUpdate = true;
  }

  // wires: slack between the fixing and the lid, then pulled out and whipping back
  function poseWires(M, tau, lt) {
    for (let k = 0; k < NW; k++) {
      const w = wires[k], W = M.wire[k], A = W.A;
      w.mesh.visible = true;
      if (tau < W.snap) {
        const p = jarPoint(M, tau, W.loc), dist = Math.hypot(p[0] - A[0], p[1] - A[1], p[2] - A[2]);
        const slack = Math.max(0, (M.kind === 'fall' ? W.len : dist * 1.12) - dist), sag = 0.75 * Math.sqrt(slack * (slack + 2 * dist)) * 0.6;
        const c = [(A[0] + p[0]) / 2 + 0.03 * (k - 1), (A[1] + p[1]) / 2 - sag, (A[2] + p[2]) / 2 + 0.05];
        setWire(w, u => { const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u; return [a * A[0] + b * c[0] + d * p[0], a * A[1] + b * c[1] + d * p[1], a * A[2] + b * c[2] + d * p[2]]; });
        w.spark.visible = false;
      } else {
        const s = tau - W.snap, ps = W.ps;
        let hx = ps[0] - A[0], hz = ps[2] - A[2]; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
        const a0 = Math.atan2(hl, A[1] - ps[1]), L = W.len, on = 1 - Math.exp(-s * 40);
        const a = a0 * Math.cos(5.2 * s) * Math.exp(-0.9 * s) * (1 - 0.25 * on) + 0.5 * on * Math.exp(-1.2 * s) * (k - 1) * 0.3;
        const end = setWire(w, u => {
          const au = a * (1 - 0.35 * u * on) + on * 0.55 * u * Math.sin(8 * u - 26 * s + k) * Math.exp(-1.6 * s);
          const r = L * u * (1 - 0.1 * on * u), side = on * 0.10 * u * Math.sin(6.5 * u - 21 * s + 2 * k) * Math.exp(-1.3 * s);
          const hx2 = Math.sin(au) * r, dn = Math.cos(au) * r;
          return [A[0] + hx * hx2 - hz * side, A[1] - dn, A[2] + hz * hx2 + hx * side];
        });
        const fl = hash(Math.floor(lt * 30) * 3.7 + k * 11.3), amp = Math.exp(-s * 5) * (fl > 0.45 ? 1 : 0.15);
        w.spark.visible = amp > 0.02; w.spark.position.set(end[0], end[1], end[2]); const sc = 0.05 + 0.16 * amp * fl; w.spark.scale.set(sc, sc, sc); w.spark.material.opacity = Math.min(1, amp * 1.5);
      }
    }
  }
  const hideWires = () => { for (const w of wires) { w.mesh.visible = false; w.spark.visible = false; } };

  const tgt = new THREE.Vector3();
  let shardSel = null;

  function update(t, shot) {
    const mode = meta.modes.includes(shot.mode) ? shot.mode : 'fall';
    const lt = shot.lt ?? t, seed = Number.isFinite(shot.seed) ? shot.seed : 1;
    const kind = mode === 'burst' ? 'burst' : 'fall';
    const M = getModel(kind, mode === 'fall' || mode === 'burst' ? seed : 1);
    for (const m of models.values()) m.group.visible = m === M;
    const backdrop = mode === 'burst' && shot.backdrop ? shot.backdrop : null;
    U.uBackdrop.value = backdrop; U.uBackOn.value = backdrop ? 1 : 0; bg.visible = !!backdrop;
    room.visible = mode === 'fall' || mode === 'floor'; shelfGroup.visible = jar2.visible = mode === 'fall';
    pedestal.visible = backWall.visible = mode === 'burst' && !backdrop;
    paperFly.visible = mode === 'shards'; paperFloor.visible = mode === 'floor'; drift.visible = mode === 'shards';
    puddle.visible = mode === 'fall' || mode === 'floor';
    lid.visible = plinth.visible = mode !== 'shards';
    M.label.visible = mode !== 'floor'; M.drops.visible = mode === 'fall' || mode === 'burst';
    U.uFog.value = 0; U.uPulse.value = 0; U.uS.value = S; U.uExpo.value = 1; U.uBody.value = 0;
    volMat.uniforms.uT.value = t; puddleMat.uniforms.uT.value = t;
    let fl = flicker(t, 1), green = 1, tubeI = 24;
    camera.up.set(0, 1, 0);

    if (mode === 'fall') {
      const hit = Number.isFinite(shot.hit) ? shot.hit : 2.0, u = lt - hit;
      const tau = u < 0 ? -(0.05 * -u + 0.26 * u * u) : integ(u, rateFall);
      const cp = u < 0 ? 0 : 1 - Math.pow(1 - clamp01(u / 0.3), 2);
      pose(M, tau, cp);
      M.cracks.material.uniforms.uCrackT.value = cp; M.cracks.material.uniforms.uOn.value = u < 0 ? 0 : 1 - 0.85 * ss((u - 0.35) / 0.5);
      M.cracks.visible = u >= 0 && u < 1.2;
      // fluid: a volume in the jar until the hit, droplets after
      vol.visible = tau <= 0;
      if (tau <= 0) {
        const P = jarPose(M, tau); vol.position.set(P.B[0], P.B[1], P.B[2]); vol.quaternion.set(P.q[0], P.q[1], P.q[2], P.q[3]);
        const th = Math.min(P.th, 0.78) + 0.05 * Math.sin(lt * 7) * Math.min(1, P.th * 3);   // fluid surface stays level while it tips, then is carried along
        const nx = -Math.sin(th), ny = Math.cos(th); volMat.uniforms.uPlane.value.set(nx, ny, 0, ny * JAR.fill * 0.97);
      }
      M.drops.material.uniforms.uTau.value = tau; M.drops.material.uniforms.uGlow.value = 1; M.drops.material.uniforms.uStretch.value = 0.012;
      puddleMat.uniforms.uC.value.set(M.com[0] + 0.05, 0); puddleMat.uniforms.uR.value = tau <= 0 ? 0 : 0.03 + 0.42 * (1 - Math.exp(-tau / 0.35));
      poseWires(M, tau, lt);
      // light
      if (tau <= 0) { const c = jarPoint(M, tau, [0, JAR.H * 0.3, 0]); greenLight.position.set(c[0], c[1], c[2] + 0.05); }
      else greenLight.position.set(M.com[0] + 0.05, 0.07 + 0.1 * ss(tau / 0.2), 0.1);
      green = tau <= 0 ? 1 : 1 + 1.3 * ss(u / 0.4) - 0.6 * ss((u - 2) / 4);
      fl = flicker(t, u > 0 && u < 0.25 ? 0.2 : 1);
      // camera: low, follows the jar down, closes in
      const c = tau <= 0 ? jarPoint(M, tau, [0, JAR.H * 0.46, 0]) : M.com;
      const sh = u > 0 ? 0.014 * Math.exp(-u * 4.5) * Math.sin(u * 62) : 0;
      const dz = u < 0 ? 0.80 + 0.28 * ss(-u / 2.2) : 0.80 - 0.06 * ss(u / 4);
      camera.fov = 42 - 19 * ss(-u / 2);
      camera.position.set(M.com[0] + 0.13 - 0.05 * ss(-u / 2), 0.11 + 0.02 * ss(u / 5) + (tau <= 0 ? 0.9 * clamp01((c[1] - 0.118) / 0.87) : 0), dz);   // rides down with the jar
      tgt.set(c[0] + 0.04, Math.max(c[1], 0.118) - 0.048 + (u > 0 ? 0.035 * ss(u / 2.5) - 0.06 * ss((u - 2.5) / 3) : 0) + sh, 0);
      camera.lookAt(tgt);
    } else if (mode === 'burst') {
      const hit = Number.isFinite(shot.hit) ? shot.hit : 1.0, u = lt - hit;
      const tau = u < 0 ? u * 0.25 : integ(u, rateBurst);
      const cp = u < 0 ? Math.pow(clamp01((u + 0.4) / 0.4), 1.7) : 1;
      pose(M, tau, cp);
      M.cracks.material.uniforms.uCrackT.value = cp; M.cracks.material.uniforms.uOn.value = 1 - 0.85 * ss((u - 0.1) / 0.5);
      M.cracks.visible = cp > 0 && u < 1.0;
      vol.visible = tau <= 0;
      vol.position.set(0, 0, 0); vol.quaternion.set(0, 0, 0, 1);
      const tr = u < 0 ? 0.012 * cp * Math.sin(lt * 53) : 0;   // the fluid trembles as the cracks spread
      volMat.uniforms.uPlane.value.set(tr, 1, tr * 0.6, JAR.fill);
      M.drops.material.uniforms.uTau.value = tau; M.drops.material.uniforms.uGlow.value = 1; M.drops.material.uniforms.uStretch.value = 0.012;
      poseWires(M, tau <= 0 ? -1 : tau, lt);
      greenLight.position.set(0, tau <= 0 ? 0.05 : 0.05 - 0.2 * ss(tau / 0.5), 0.08 + 0.25 * ss(tau / 0.3));
      green = 1 + 0.5 * cp * (u < 0 ? 1 : 0) + (u >= 0 ? 0.9 * Math.exp(-u * 0.5) : 0);
      fl = flicker(t, u > -0.05 && u < 0.3 ? 0.15 : 1) * (u < 0 ? 1 - 0.35 * cp * (0.5 + 0.5 * Math.sin(lt * 61)) : 1);
      const sh = u > 0 ? 0.006 * Math.exp(-u * 5) * Math.sin(u * 70) : 0;
      camera.fov = 38;
      camera.position.set(0.02 * Math.sin(lt * 0.4), 0.135 + sh, 0.70 - 0.05 * ss((lt) / Math.max(hit, 0.3)) - 0.03 * ss(u / 3));
      tgt.set(0, 0.098 + sh, 0); camera.lookAt(tgt);
      bgMat.uniforms.uDim.value = 0.62;
      tubeI = 20;
    } else if (mode === 'floor') {
      pose(M, M.tEnd, 1);
      M.cracks.visible = false; vol.visible = false; hideWires();
      const pc = [M.com[0] + 0.05, 0];
      puddleMat.uniforms.uC.value.set(pc[0], pc[1]); puddleMat.uniforms.uR.value = 0.45 + 0.012 * Math.min(lt, 30) * 0.3;
      paperFloor.position.set(pc[0] + 0.10, 0.0045, 0.43); paperFloor.rotation.set(-Math.PI / 2, 0, -0.2);
      U.uExpo.value = 1.3;
      greenLight.position.set(pc[0] + 0.0, 0.12, 0.2);
      fl = flicker(t, 1.25); green = 1.25 + 0.2 * Math.sin(t * 1.3);
      const p = ss(clamp01(lt / Math.min(Math.max(shot.dur ?? 8, 1), 12)));
      camera.fov = 36;
      camera.position.set(pc[0] + mix(0.30, 0.20, p), mix(0.34, 0.24, p), mix(1.12, 0.92, p));
      tgt.set(pc[0] + 0.08, 0.035, 0.36); camera.lookAt(tgt);
    } else { // shards
      const cam = [0, 1, 2].includes(shot.cam) ? shot.cam : 0;
      const b = beatAt(t), pulse = b.pulse;
      const kickT = b.index + (1 - Math.exp(-5 * b.phase)) / (1 - Math.exp(-5));   // jumps ahead on every beat
      M.cracks.visible = false; vol.visible = false; hideWires();
      U.uFog.value = 0.6; U.uPulse.value = pulse; U.uS.value = S * 2.3; U.uExpo.value = 1.25 + 0.6 * pulse; U.uBody.value = 1;
      // the camera and the stream of shards
      const fdir = new THREE.Vector3(), rt = new THREE.Vector3(), up = new THREE.Vector3();
      if (cam === 0) { camera.position.set(0.05 * Math.sin(t * 0.21), 0.03 * Math.sin(t * 0.17), 1.0); tgt.set(0, 0, 0); fdir.set(0, -0.12, 1); camera.fov = 44; }
      else if (cam === 1) { camera.position.set(0.1 * Math.sin(t * 0.15), -0.72, 0.62); tgt.set(0, 0.12, 0); fdir.set(0.05, -1, 0.45); camera.fov = 48; }
      else { camera.position.set(0.55 * Math.cos(t * 0.07 + 0.6), 0.1, 0.72 + 0.1 * Math.sin(t * 0.07)); tgt.set(0, 0, 0); fdir.set(0.8, -0.25, 0.55); camera.fov = 36; }
      camera.up.set(Math.sin(0.12 * Math.sin(t * 0.13 + cam)), 1, 0).normalize();
      camera.lookAt(tgt);
      fdir.normalize(); rt.crossVectors(fdir, new THREE.Vector3(0, 1, 0.001)).normalize(); up.crossVectors(rt, fdir).normalize();
      const r0 = -2.6, r1 = 1.35, Lr = r1 - r0;
      if (!shardSel || shardSel.M !== M) {
        const big = M.bySize.filter(q => M.res.pieces[q].size > 0.009).slice(0, 110), sel = big.map((q, i) => ({ q, i }));
        shardSel = { M, sel, on: new Uint8Array(M.n) }; for (const s of sel) shardSel.on[s.q] = 1;
      }
      const X = M.xfData;
      for (let i = 0; i < M.n; i++) if (!shardSel.on[i]) { X[i * 8] = 0; X[i * 8 + 1] = -500; X[i * 8 + 2] = 0; X[i * 8 + 3] = 0; X[i * 8 + 7] = 1; }
      const sd = seed * 17.17 + cam * 3.3;
      for (const s of shardSel.sel) {
        const i = s.i, o = s.q * 8, h = k => hash(i * 12.9898 + k * 78.233 + sd);
        const big = i < 28 ? 1 : 0;
        const a = (h(1) * 2 - 1) * (big ? 0.85 : 1.35), bb = (h(2) * 2 - 1) * (big ? 0.5 : 0.8), sp = (0.07 + 0.2 * h(3)) * (big ? 0.8 : 1.2);
        const along = r0 + (((h(4) * Lr + sp * t) % Lr) + Lr) % Lr;
        const wob = 0.04 * Math.sin(t * (0.3 + 0.4 * h(5)) + h(6) * 6.28);
        X[o] = tgt.x + rt.x * (a + wob) + up.x * bb + fdir.x * along; X[o + 1] = tgt.y + rt.y * (a + wob) + up.y * (bb + wob) + fdir.y * along; X[o + 2] = tgt.z + rt.z * a + up.z * bb + fdir.z * along;
        X[o + 3] = 1;
        let ax = [h(7) * 2 - 1, h(8) * 2 - 1, h(9) * 2 - 1]; const al = Math.hypot(ax[0], ax[1], ax[2]) || 1; ax = ax.map(x => x / al);
        const ang = h(10) * 6.28 + (0.25 + 0.7 * h(11)) * t * (big ? 0.6 : 1) + (0.25 + 0.5 * h(12)) * kickT * (h(13) < 0.5 ? -1 : 1);
        const q = Q.qmul(Q.qAxis(ax, ang), Q.qAxis([0, 1, 0], h(14) * 6.28));
        X[o + 4] = q[0]; X[o + 5] = q[1]; X[o + 6] = q[2]; X[o + 7] = q[3];
      }
      M.xf.needsUpdate = true;
      const du = driftMat.uniforms; du.uT.value = t + seed * 31.7; du.uC.value.copy(tgt); du.uRt.value.copy(rt); du.uUp.value.copy(up); du.uFl.value.copy(fdir); du.uRange.value.set(r0, r1); du.uGlow.value = 0.9 + 0.5 * pulse;
      // the torn label, fluttering among them
      const pm = paperFly.material.uniforms; pm.uT.value = t; pm.uWet.value = 0.08;
      const pd = cam === 2 ? 0.0 : cam === 1 ? 0.05 : 0.12;
      paperFly.position.set(0.16 * Math.sin(t * 0.31 + seed) + 0.05 * Math.sin(t * 0.9), 0.07 * Math.sin(t * 0.23 + 1.3) + (cam === 1 ? 0.12 : 0.02), pd + 0.12 * Math.sin(t * 0.19));
      paperFly.rotation.set(0.45 * Math.sin(t * 0.41) + (cam === 1 ? 0.9 : 0), 0.6 * Math.sin(t * 0.27 + 1) + (cam === 2 ? 0.5 * Math.cos(t * 0.07 + 0.6) : 0) + 0.12 * pulse, 0.3 * Math.sin(t * 0.33 + 2) - 0.2);
      greenLight.position.set(0.3 * Math.sin(t * 0.2), -0.35, 0.3);
      green = 1.0 + 0.9 * pulse; fl = flicker(t, 0.8);
      U.uTubePos.value.set(0.4, 1.6, 1.0);
    }
    if (mode !== 'shards') U.uTubePos.value.set(mode === 'burst' ? 0.5 : M.com[0] + 0.55, 2.0, 0.8);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    U.uFlick.value = fl; U.uGreen.value = green; U.uGreenPos.value.copy(greenLight.position);
    tubeLight.position.copy(U.uTubePos.value); tubeLight.intensity = tubeI * fl; greenLight.intensity = 0.09 * green;
    tubeMat.color.setScalar(0.25 + 0.75 * fl);
    rimLight.intensity = 0.35 * (0.5 + 0.5 * fl);
    backLight.intensity = mode === 'burst' && !backdrop ? 0.5 * (0.3 + 0.7 * fl) : 0;
  }

  // build the fall model now (the usual one); burst is built on first use
  getModel('fall', 1);
  return { scene, camera, update };
}

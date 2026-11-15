// lab.js: the main world. Two brains in neighbouring jars on a steel shelf in a dark laboratory.
// SHE = left jar (pale brain, cracked jar with a taped patch that leaks), HE = right jar (dark stitched brain, murky fluid).
// Everything is a pure function of (t, shot): no stepped simulation, bubbles and drips are closed-form.
import * as THREE from 'three';
import { BEAT, BEAT0 } from '../audio.js';
import { LYRICS } from '../lyrics.js';
import { onsetAt, beatAt } from '../engine.js';
import { lerp, clamp, sstep, hash, hash2, hold, glance, rngOf, makeBrain, cerebellumGeo, brainMaterial, TubeSet, tubeMaterial, EyeSet, glassMaterial, fluidMaterial, bubbleMaterial } from './lab/parts.js';
import { R, JX, GY0, GY1, SH, WALLZ, radialTexture, nurseTextures, tapeTexture, labelTexture, buildRoom, jarGeos, buildNeighbours, buildCurtain } from './lab/room.js';
import { LabPost } from './lab/post.js';

export const meta = {
  modes: ['wide', 'her', 'him', 'gaze', 'kiss', 'leak', 'nurse', 'lightson', 'curtain', 'shelf', 'rows', 'empty', 'dusty', 'dark'],
  params: { cam: '0..1 camera variation', seed: 'blink / saccade / glance seed', side: "curtain: 'her' (default) or 'him' = which jar is in front of the cloth", open: 'dusty: lt at which the eye starts to open (default 35% of the shot)' },
};

const BY = 1.52, S = 0.64, EYE_R = [0.152, 0.138, 0.134, 0.156], CRACK_AZ = -0.5, CAP = 220;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// words per singer (0 = her, 1 = him): start times, for word pulses and bubble bursts
const WORDS = [0, 1].map(i => {
  const t0 = [];
  for (const L of LYRICS) if (L.who === 'both' || L.who === (i ? 'him' : 'her')) for (const w of L.words) t0.push(w[1]);
  t0.sort((a, b) => a - b); return t0;
});
const lastWord = (w, t) => { let a = -1, b = w.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (w[m] <= t) a = m; else b = m - 1; } return a; };

class Hero {
  constructor(i, G, geos, env, radial, dark) {
    this.i = i; this.sgn = i ? -1 : 1;
    const g = this.g = new THREE.Group();
    this.col0 = new THREE.Color(...(i ? [0.2, 0.85, 0.34] : [0.92, 0.74, 0.13])); this.col = this.col0.clone();
    this.level0 = i ? 2.52 : 2.26; this.level = this.level0; this.murk0 = i ? 0.5 : 0.28;
    this.glowU = { value: 1 };
    const add = (geo, mat, order = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; m.frustumCulled = false; parent.add(m); return m; };
    this.fl = ['back', 'front', 'surf'].map(p => { const m = fluidMaterial(G, p, false, { glow: this.glowU, murk: this.murk0 }); m.uniforms.uCol.value = this.col; add(p === 'surf' ? geos.surf : geos.fluid, m, p === 'back' ? 1 : 3); return m; });
    this.glass = glassMaterial(G, { glowK: this.glowU }); this.glass.uniforms.uGlowCol.value = this.col; add(geos.glass, this.glass, 4);
    add(geos.lid, dark);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); add(geos.lamp, this.lampMat);
    this.poolMat = new THREE.MeshBasicMaterial({ map: radial, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    add(new THREE.PlaneGeometry(4.4, 3.0).rotateX(-Math.PI / 2).translate(0, 0.03, 0.08), this.poolMat, 0);
    add(new THREE.BoxGeometry(2.5, 0.03, 2.5).translate(0, 0.012, 0), dark);
    // brain
    const B = makeBrain(i ? 23 : 11, 150, i ? 4.4 : 4.2, i ? 1.05 : 1.0);
    this.bmat = brainMaterial(G, { color: i ? 0xa05f6c : 0xe6aca6, scar: !!i, rough: i ? 0.6 : 0.5, coat: i ? 0.35 : 0.55 });
    if (i) this.bmat.userData.u.uGlowCol.value.setRGB(1.0, 0.25, 0.1); else this.bmat.userData.u.uGlowCol.value.setRGB(1.0, 0.4, 0.3);
    this.brainG = new THREE.Group(); this.brainG.matrixAutoUpdate = false; g.add(this.brainG);
    add(B.geo, this.bmat, 0, this.brainG); add(cerebellumGeo(), this.bmat, 0, this.brainG);
    this.pads = []; const rnd = rngOf(77 + i * 13), o = [0, 0, 0];
    for (let k = 0; k < 5; k++) {
      const az = (k + 0.5) / 5 * 6.283 + rnd() * 0.5, el = 0.5 + rnd() * 0.5, dy = Math.sin(el), dr = Math.cos(el);
      B.point(dr * Math.cos(az), dy, dr * Math.sin(az), o);
      const p = V3(o[0], o[1], o[2]).multiplyScalar(1.01); this.pads.push(p); this.bmat.userData.u.uPads.value[k].copy(p);
      add(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.5, 1).translate(p.x, p.y, p.z), dark, 0, this.brainG);
    }
    this.wireMat = tubeMaterial(G, { base: 0x08090b, gloss: 60, spec: 0.7 }); this.wires = new TubeSet(5, 16, 5, this.wireMat); g.add(this.wires.mesh);
    this.fleshMat = tubeMaterial(G, { base: i ? 0x7b4350 : 0xcf928c, gloss: 30, spec: 0.55 }); this.flesh = new TubeSet(3, 14, 7, this.fleshMat); g.add(this.flesh.mesh);
    // bubbles
    this.bpos = new Float32Array(CAP * 3); this.bsize = new Float32Array(CAP);
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(this.bpos, 3)); bg.setAttribute('aSize', new THREE.BufferAttribute(this.bsize, 1));
    this.bubMat = bubbleMaterial(G); this.bub = new THREE.Points(bg, this.bubMat); this.bub.frustumCulled = false; this.bub.renderOrder = 2; g.add(this.bub);
    this.A = { lidK: [1, 1] }; this.M = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.fwd = V3(); this.face = V3();
  }
}

export async function create(ctx) {
  const { renderer, width: W, height: H } = ctx;
  const G = {
    uKeyDir: { value: V3(0.1, 0.8, 0.58).normalize() }, uKeyCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.004, 0.005, 0.005) },
    uFogD: { value: 0.026 }, uTime: { value: 0 }, uGlint: { value: 1 }, uEyeGlow: { value: 0.05 },
  };
  const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0x000000, 0.026);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 150);

  // environment for wet / metallic reflections: a cold tube overhead, a faint green floor
  const envScene = new THREE.Scene(), eb = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), side: THREE.DoubleSide })); m.position.set(x, y, z); envScene.add(m); };
  eb(7, 0.2, 0.7, 0, 5, 2.5, [5, 6.5, 6]); eb(0.3, 5, 2, -7, 1, 4, [0.25, 0.32, 0.4]); eb(14, 0.2, 10, 0, -3.5, 0, [0.05, 0.14, 0.05]);
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(envScene, 0.03).texture; pm.dispose();
  scene.environment = env;

  const keyLight = new THREE.DirectionalLight(0xffffff, 3); scene.add(keyLight, keyLight.target);
  const radial = radialTexture(), geos = jarGeos();
  // conduit from each lid up to the shelf above
  const room = buildRoom(G, env); scene.add(room.group);
  const heroes = [0, 1].map(i => new Hero(i, G, geos, env, radial, room.dark));
  for (const h of heroes) scene.add(h.g);
  const eyes = new EyeSet(4, G); scene.add(eyes.mesh);
  eyes.style(0, [0.35, 0.75, 0.8], [0.55, 0.2, 0.22]); eyes.style(1, [0.35, 0.75, 0.8], [0.55, 0.2, 0.22]);
  eyes.style(2, [0.95, 0.6, 0.12], [0.42, 0.13, 0.17]); eyes.style(3, [0.95, 0.6, 0.12], [0.42, 0.13, 0.17]);
  const nb = buildNeighbours(G, geos, room.dark, radial); scene.add(nb.group);
  const curtain = buildCurtain(G, room.dark); scene.add(curtain.group);
  const post = new LabPost(W, H), nt = nurseTextures(); post.U.tNurse.value = nt.nurse; post.U.tHand.value = nt.hand;

  // ── her jar: crack, taped patch, wet streak, drop, pool ──
  const her = heroes[0], him = heroes[1];
  const onGlass = (az, y, r = R + 0.008) => V3(Math.sin(az) * r, y, Math.cos(az) * r);
  const crackMat = new THREE.MeshBasicMaterial({ color: 0xffffff }), crack = new TubeSet(5, 10, 3, crackMat), cr = rngOf(9);
  const crackPath = (az0, y0, az1, y1, i, w) => { for (let k = 0; k <= 10; k++) { const f = k / 10; crack.pts[k].copy(onGlass(lerp(az0, az1, f) + (cr() - 0.5) * 0.07, lerp(y0, y1, f) + (cr() - 0.5) * 0.03, R + 0.004)); } crack.set(i, u => 1.5 * w * (1 - 0.7 * u)); };
  crackPath(CRACK_AZ - 0.17, 1.42, CRACK_AZ + 0.1, 0.42, 0, 0.007); crackPath(CRACK_AZ - 0.08, 1.1, CRACK_AZ - 0.42, 1.3, 1, 0.005); crackPath(CRACK_AZ + 0.0, 0.8, CRACK_AZ + 0.36, 1.05, 2, 0.005);
  crackPath(CRACK_AZ + 0.05, 0.6, CRACK_AZ - 0.25, 0.4, 3, 0.004); crackPath(CRACK_AZ - 0.13, 1.28, CRACK_AZ + 0.12, 1.5, 4, 0.004);
  crack.done(); her.g.add(crack.mesh);
  const tape = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.46, 20, 1, true, CRACK_AZ - 0.33, 0.66).translate(0, 0.86, 0),
    new THREE.MeshStandardMaterial({ map: tapeTexture(), transparent: true, alphaTest: 0.4, roughness: 0.85 }));
  tape.renderOrder = 5; her.g.add(tape);
  const wetMat = tubeMaterial(G, { base: 0x20281a, gloss: 90, spec: 1.6 }), streak = new TubeSet(1, 14, 5, wetMat); her.g.add(streak.mesh);
  const dropAz = y => CRACK_AZ + 0.04 + 0.035 * Math.sin(y * 9);
  const streakPt = (f, out) => { // f 0..1 from the tape's lower edge down the glass, over the base ring, onto the shelf
    if (f < 0.72) { const y = lerp(0.66, GY0 + 0.01, f / 0.72); return out.copy(onGlass(dropAz(y), y)); }
    const g2 = (f - 0.72) / 0.28, az = dropAz(GY0); return out.copy(onGlass(az, lerp(GY0, 0.03, sstep(0.15, 1, g2)), lerp(R + 0.008, R * 1.17, sstep(0, 0.5, g2))));
  };
  for (let k = 0; k <= 14; k++) streakPt(k / 14, streak.pts[k]);
  streak.set(0, u => 0.011 + 0.006 * Math.sin(u * 23)); streak.done();
  const dropMat = new THREE.MeshPhysicalMaterial({ color: 0x6f8a3a, roughness: 0.05, metalness: 0, clearcoat: 1, emissive: new THREE.Color(0.25, 0.4, 0.08), emissiveIntensity: 0.6 });
  const drop = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), dropMat); her.g.add(drop);
  const poolShape = new THREE.Shape(), pr = rngOf(5);
  for (let k = 0; k <= 40; k++) { const a = k / 40 * 6.2832, rr = 1 + 0.16 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 5 + 2) + 0.05 * pr(); k ? poolShape.lineTo(Math.cos(a) * rr * 1.25, Math.sin(a) * rr) : poolShape.moveTo(rr * 1.25, 0); }
  const puddleMat = new THREE.MeshPhysicalMaterial({ color: 0x101a08, roughness: 0.04, metalness: 0.2, clearcoat: 1, emissive: new THREE.Color(0.5, 0.75, 0.15), emissiveIntensity: 0.05 });
  const puddle = new THREE.Mesh(new THREE.ShapeGeometry(poolShape, 8).rotateX(-Math.PI / 2), puddleMat);
  const pc = onGlass(dropAz(GY0), 0.034, R * 1.32); puddle.position.copy(pc); her.g.add(puddle);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40).rotateX(-Math.PI / 2), ringMat); ripple.position.copy(pc).setY(0.038); her.g.add(ripple);
  // his jar: specimen label (only shown on the empty jar)
  const label = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.6, 24, 1, true, -0.4, 0.9).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ map: labelTexture('YOU'), roughness: 0.9 }));
  label.renderOrder = 5; him.g.add(label);
  // cobwebs for the dusty jar
  const web = (() => {
    const p = [], r = rngOf(3), fan = (ax, ay, az, bx, by, bz, cx, cy, cz, n, m) => {
      const A = V3(ax, ay, az), B = V3(bx, by, bz), C = V3(cx, cy, cz), a = V3(), b = V3();
      for (let i = 0; i <= n; i++) { a.lerpVectors(B, C, i / n); p.push(A.x, A.y, A.z, a.x, a.y, a.z); }
      for (let j = 1; j <= m; j++) for (let i = 0; i < n; i++) {
        const f = j / (m + 0.5) + (r() - 0.5) * 0.04; a.lerpVectors(B, C, i / n).lerp(A, 1 - f); b.lerpVectors(B, C, (i + 1) / n).lerp(A, 1 - f); a.y -= 0.02; p.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    };
    fan(-1.9, 2.5, 0.6, -0.98, 2.4, 0.3, -1.03, 1.25, 0.35, 8, 8); fan(1.95, 2.45, 0.6, 0.98, 2.35, 0.3, 1.03, 1.45, 0.35, 7, 7);
    fan(1.95, 0.25, 0.9, 1.0, 0.95, 0.4, 1.12, 0.2, 0.6, 6, 6); fan(0.25, 2.55, 1.03, -0.65, 2.2, 0.82, 0.72, 2.02, 0.76, 7, 5); fan(-1.9, 0.5, 0.8, -1.0, 1.0, 0.4, -1.1, 0.3, 0.55, 5, 5);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(0.5, 0.5, 0.45), transparent: true, opacity: 0.7, fog: false })); l.frustumCulled = false; return l;
  })();
  her.g.add(web);
  // kiss: a pulse of light between the jars, and a jagged arc
  const kissMat = new THREE.MeshBasicMaterial({ map: radial, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false });
  const kissGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.4), kissMat); kissGlow.position.set(0, 1.5, 0.5); kissGlow.renderOrder = 7; scene.add(kissGlow);
  const arcGeo = new THREE.BufferGeometry(); arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2 * 18), 3));
  const arcMat = new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const arcs = new THREE.LineSegments(arcGeo, arcMat); arcs.frustumCulled = false; arcs.renderOrder = 7; scene.add(arcs);

  // scratch
  const cp = V3(), ct = V3(), tmp = V3(), tmp2 = V3(), eu = new THREE.Euler(), pos = V3(), sc = V3(), eq = new THREE.Quaternion(), em = new THREE.Matrix4(), UP = V3(0, 1, 0), ZERO = V3();
  const epos = V3(), gz = V3(), sf = V3(), ctrl = [V3(), V3(), V3(), V3()], under = new THREE.Color(), nursePt = V3(), c1 = new THREE.Color();
  const V = [{}, {}];
  let placed = '';

  function poseHero(h, t, bt, sd) {
    const A = h.A, i = h.i, v = V[i], col = h.col, jx = h.g.position.x, jy = h.g.position.y;
    h.brainG.visible = A.vis; h.flesh.mesh.visible = A.vis;
    const tr = A.tremble;
    pos.set(A.x + tr * Math.sin(t * 61 + i), BY + A.y + tr * Math.sin(t * 53 + 2 + i), A.z + tr * Math.sin(t * 47 + 4));
    eu.set(A.pitch, A.yaw, A.roll, 'YXZ'); h.q.setFromEuler(eu);
    const s0 = S * (1 + A.swell); sc.set(s0 * (1 - 0.45 * (A.sy - 1)), s0 * A.sy, s0 * A.sz);
    h.M.compose(pos, h.q, sc); h.brainG.matrix.copy(h.M); h.brainG.matrixWorldNeedsUpdate = true;
    h.fwd.set(0, 0, 1).applyQuaternion(h.q);
    under.copy(col).multiplyScalar(A.glow * 0.9);
    // fluid, glass, lamp, glow on the shelf
    h.glowU.value = A.glow;
    for (const m of h.fl) { m.uniforms.uLevel.value = h.level; m.uniforms.uTilt.value.set(A.tiltX, A.tiltZ); }
    h.fl[1].uniforms.uMurk.value = h.murk;
    h.lampMat.color.copy(col).multiplyScalar(A.glow * 1.0); h.poolMat.color.copy(col).multiplyScalar(A.glow * 0.7);
    // brain
    const bu = h.bmat.userData.u;
    bu.uUnderCol.value.copy(under); bu.uInner.value = A.inner; bu.uTwinkle.value = A.twinkle;
    bu.uRing.value[0].set(v.age * 2.2, v.age < 1.2 ? Math.exp(-v.age * 3.2) * 1.3 * A.perf * v.on : 0);
    bu.uRing.value[1].set(v.age2 * 2.2, v.age2 < 1.2 ? Math.exp(-v.age2 * 3.2) * 1.3 * A.perf * v.on : 0);
    bu.uRip.value.set(0.012 * v.sing * A.perf + 0.006 * A.inner, t * 9);
    // wires
    h.wireMat.uniforms.uUnder.value.copy(under).multiplyScalar(0.5);
    h.wireMat.uniforms.uPulse.value.set(v.nextIn < 0.24 ? 1 - v.nextIn / 0.24 : 2, 5 * A.perf * v.on, (0.25 * A.twinkle + 3.5 * v.sing * A.perf));
    h.wireMat.uniforms.uPulseCol.value.setRGB(0.5, 0.9, 1.0);
    for (let k = 0; k < 5; k++) {
      const a = (k + 0.5) / 5 * 6.283, hx = 0.42 * Math.cos(a), hz = 0.42 * Math.sin(a);
      ctrl[0].set(hx, GY1 + 0.02, hz); ctrl[1].set(hx * 1.1, GY1 - 0.32, hz * 1.1);
      if (A.vis) {
        ctrl[3].copy(h.pads[k]).applyMatrix4(h.M);
        ctrl[2].lerpVectors(ctrl[1], ctrl[3], 0.62); ctrl[2].x += hx * 0.35 + 0.02 * Math.sin(t * 1.3 + k); ctrl[2].z += hz * 0.35 + 0.02 * Math.cos(t * 1.1 + k * 2); ctrl[2].y += 0.1;
      } else { // loose, dangling
        const sw = 0.03 * Math.sin(t * 0.7 + k * 1.7), l = 0.75 + 0.22 * hash2(k, i + 3);
        ctrl[2].set(hx * 1.25 + sw, GY1 - 0.32 - l * 0.55, hz * 1.25 + sw * 0.6); ctrl[3].set(hx * 1.3 + sw * 2.2, GY1 - 0.32 - l, hz * 1.3 + sw * 1.4);
      }
      h.wires.catmull(ctrl); h.wires.set(k, 0.017);
    }
    h.wires.done();
    // eyes on stalks
    h.fleshMat.uniforms.uUnder.value.copy(under);
    const lvlTop = h.level - 0.2;
    for (let e = 0; e < 2; e++) {
      const idx = i * 2 + e, sx = e ? 1 : -1, ph = idx * 1.9;
      const bob = beatAt(t - 0.09).pulse;
      epos.set(sx * (0.46 + 0.03 * Math.sin(t * 1.3 + ph)) + (A.eyeX || 0), -0.5 + (e ? 0.05 : -0.03) + 0.05 * Math.sin(t * 1.7 + ph) - 0.07 * bob * A.amp + (A.eyeY || 0), 0.88 + 0.04 * Math.sin(t * 0.9 + ph * 2) + A.eyeOut).applyMatrix4(h.M);
      const ER = EYE_R[idx], rr = Math.hypot(epos.x, epos.z), rmax = R - 0.05 - ER - 0.015; if (rr > rmax) { epos.x *= rmax / rr; epos.z *= rmax / rr; }
      epos.y = clamp(epos.y, GY0 + 0.3, lvlTop);
      // stalk
      if (A.vis) {
        ctrl[0].set(sx * 0.2, -0.4, 0.42).applyMatrix4(h.M); gz.set(jx + epos.x, jy + epos.y, epos.z);
        tmp.copy(A.look).sub(gz).normalize();
        const jt = A.jit; tmp.x += jt * (hold(t, 0.55, sd + i * 7 + 1) - 0.5) * 2; tmp.y += jt * (hold(t, 0.55, sd + i * 7 + 2) - 0.5) * 1.4; tmp.normalize();
        sf.copy(h.fwd).multiplyScalar(0.35).addScaledVector(tmp, 0.65).normalize();
        em.lookAt(sf, ZERO, UP); eq.setFromRotationMatrix(em);
        ctrl[2].copy(epos).addScaledVector(sf, -ER * 0.85);
        ctrl[1].lerpVectors(ctrl[0], ctrl[2], 0.5); ctrl[1].y -= 0.12; ctrl[1].addScaledVector(sf, -0.12);
        const P = h.flesh.pts;
        for (let k = 0; k <= 14; k++) { const f = k / 14, a = (1 - f) * (1 - f), b = 2 * f * (1 - f), c = f * f; P[k].set(a * ctrl[0].x + b * ctrl[1].x + c * ctrl[2].x, a * ctrl[0].y + b * ctrl[1].y + c * ctrl[2].y, a * ctrl[0].z + b * ctrl[1].z + c * ctrl[2].z); }
        h.flesh.set(e, u => 0.026 + 0.05 * u * u * u * u + 0.014 * (1 - u) * (1 - u));
        gz.copy(tmp).applyQuaternion(eq.clone().invert());
        const lk = A.lidK[e], bl = A.blink, up = lerp(-0.04, lerp(A.lidUp, -0.04, bl), lk), lo = lerp(-0.04, lerp(A.lidLo, -0.04, bl * 0.9), lk);
        tmp2.set(jx + epos.x, jy + epos.y, epos.z);
        eyes.set(idx, tmp2, eq, ER, gz, up, lo, A.tilt * (e ? -1 : 1), clamp(A.pupil), under);
      } else { tmp2.set(0, -60, 0); eyes.set(idx, tmp2, eq.identity(), 0.0001, gz.set(0, 0, 1), 0, 0, 0, 0, under); }
    }
    // tail: the brainstem / spinal cord, curling
    if (A.vis) {
      const P = h.flesh.pts, n = 14, ds = 1.5 / n; let x = 0, y = -0.4, z = -0.3;
      for (let k = 0; k <= n; k++) {
        const f = k / n, th = 0.1 + A.tailCurl * Math.pow(f, 1.3) * 2.2 + 0.25 * Math.sin(t * A.tailSpd * 0.5 - f * 2.5 + i) * A.tailWag * 2;
        P[k].set(x + A.tailWag * f * Math.sin(t * A.tailSpd - f * 3.4 + i * 2), y, z).applyMatrix4(h.M);
        y -= Math.cos(th) * ds; z -= Math.sin(th) * ds;
      }
      for (let k = 0; k <= n; k++) { const rr = Math.hypot(P[k].x, P[k].z); if (rr > R - 0.12) { P[k].x *= (R - 0.12) / rr; P[k].z *= (R - 0.12) / rr; } P[k].y = Math.max(P[k].y, GY0 + 0.1); }
      h.flesh.set(2, u => (0.072 * (1 - 0.8 * u) + 0.012) * (1 + 0.16 * Math.sin(u * 38)));
    }
    h.flesh.done();
    // bubbles
    let n = 0; const P = h.bpos, Z = h.bsize, lvl = h.level - 0.04, y0 = GY0 + 0.05;
    const put = (x, y, z, r) => { if (n >= CAP || r <= 0 || y > lvl) return; const rr = Math.hypot(x, z); if (rr > 0.9) { x *= 0.9 / rr; z *= 0.9 / rr; } P[n * 3] = x; P[n * 3 + 1] = y; P[n * 3 + 2] = z; Z[n++] = r; };
    for (let j = 0; j < 28; j++) {
      const k = clamp(A.bub * 28 - j); if (k <= 0) break;
      const sp = 0.07 + 0.1 * hash2(j, i + 1), u = (t * sp + hash2(j, i + 7)) % 1, a = hash2(j, i + 3) * 6.283, rr = 0.5 + 0.38 * hash2(j, i + 5);
      put(rr * Math.cos(a) + 0.03 * Math.sin(t * 2 + j), y0 + u * (lvl - y0), rr * Math.sin(a) + 0.03 * Math.cos(t * 1.7 + j), (0.016 + 0.034 * hash2(j, 9)) * k * Math.min(1, u * 8));
    }
    if (A.bub > 0.2) for (let b = 0; b < 5; b++) {
      const kb = bt.index - b, tb = BEAT0 + kb * BEAT, age = t - tb, amp = clamp(onsetAt(tb + 0.033) * 0.9, 0.25, 1) * A.amp;
      for (let j = 0; j < 5; j++) { const hh = hash2(kb * 5 + j, i + 11), a = hh * 40, rr = 0.3 + 0.55 * hash2(kb * 5 + j, i + 13);
        put(rr * Math.cos(a) + 0.03 * Math.sin(t * 3 + j), y0 + age * (0.75 + 0.6 * hh) + 0.1 * age * age, rr * Math.sin(a), (0.018 + 0.022 * hh) * amp * Math.min(1, age * 12)); }
    }
    if (A.vis && A.perf > 0.3) { const w = WORDS[i];
      for (let k = v.idx; k >= 0 && t - w[k] < 3.0; k--) for (let j = 0; j < 8; j++) {
        const age = t - w[k] - j * 0.022; if (age < 0) continue;
        const hh = hash2(k * 8 + j, i + 17), a = hash2(k * 8 + j, i + 19) * 6.283, ca = Math.cos(a), sa = Math.sin(a);
        put(pos.x + ca * (0.26 + 0.13 * age) + 0.025 * Math.sin(t * 5 + j), pos.y + 0.12 + 0.2 * hh + age * (0.45 + 0.5 * hh) + 0.3 * age * age, pos.z + sa * (0.36 + 0.13 * age), (0.03 + 0.045 * hash2(k * 8 + j, 23)) * Math.min(1, age * 10));
      }
    }
    h.bub.geometry.setDrawRange(0, n); h.bub.geometry.attributes.position.needsUpdate = true; h.bub.geometry.attributes.aSize.needsUpdate = true;
    h.bubMat.uniforms.uCol.value.copy(col).addScalar(0.15).multiplyScalar(1.3 * A.glow);
    h.bubMat.uniforms.uPx.value = H / (2 * Math.tan(camera.fov * Math.PI / 360));
  }

  function update(t, s) {
    const mode = meta.modes.includes(s.mode) ? s.mode : 'wide';
    const test = !(s.dur < 300), lt = test ? s.lt % 10 : s.lt, dur = test ? 10 : s.dur, p = clamp(lt / dur), ep = sstep(0, 1, p);
    const sd = (s.seed ?? 1) * 3.71, cv = s.cam ?? 0;
    const bt = s.beat, bp = bt.pulse, en = clamp(s.energy * 1.3), on = Math.min(1.4, s.onset || 0);
    const beatSway = Math.sin(Math.PI * (bt.index + bt.phase));
    G.uTime.value = t; post.U.uTime.value = t;

    // ── voices ──
    for (let i = 0; i < 2; i++) {
      const v = V[i], match = s.who === 'both' || s.who === (i ? 'him' : 'her'), w = WORDS[i];
      v.sing = match ? s.sing : 0;
      v.lineK = match && s.line ? clamp((t - s.line.t0 + 0.3) / 0.3) * clamp((s.line.t1 + 0.4 - t) / 0.4) : 0;
      v.idx = lastWord(w, t + 0.05); v.age = v.idx >= 0 ? Math.max(0, t - w[v.idx]) : 99; v.age2 = v.idx >= 1 ? t - w[v.idx - 1] : 99;
      v.nextIn = v.idx + 1 < w.length ? w[v.idx + 1] - t : 99;
      v.on = v.lineK > 0 || v.age < 1 ? 1 : 0; v.wp = v.age < 1.5 && v.on ? Math.exp(-v.age * 6) : 0;
    }

    // ── light ──
    const flick = hash(Math.floor(t * 17) + sd) > 0.84 && hash2(Math.floor(t * 1.1), 5 + sd) > 0.62 ? 0.3 : 1;
    const L = { key: flick * (1 - 0.25 * clamp(on - 0.7)), keyCol: [0.72, 0.95, 0.9], keyDir: [0.1, 0.8, 0.58], amb: 0.005, glowK: 1, nGlow: 0.4 * (0.8 + 0.2 * bp * en), wallK: 0.02, tube: flick,
      innerK: 1, fog: 0.026, exp: 1.0, bloom: 1, white: 0, fade: 1, tint: [1, 1, 1], glint: 1, eyeGlow: 0.05, env: 1, shW: 0, handW: 0, mid: 0 };
    her.g.position.set(-JX, 0, 0); him.g.position.set(JX, 0, 0);
    her.col.copy(her.col0); him.col.copy(him.col0); her.level = her.level0; him.level = him.level0; her.murk = her.murk0; him.murk = him.murk0;
    let showHeroes = true, showHim = true, nbMode = 'n', fov = 30, slide = 0;
    const drift = (a, f, o = 0) => a * Math.sin(t * f + o + sd);

    // ── camera and light per mode ──
    switch (mode) {
      case 'wide': case 'dark': case 'lightson':
        cp.set(lerp(-0.7, 0.7, cv) + drift(0.12, 0.21), 1.75 + drift(0.05, 0.17, 1), lerp(9.7, 8.0, ep)); ct.set(cp.x * 0.25, 1.28, 0); break;
      case 'her': case 'him': { const sg = mode === 'her' ? -1 : 1;
        cp.set(sg * (2.25 - 0.9 * cv) + drift(0.1, 0.23), 1.6 + 0.3 * cv + drift(0.04, 0.19, 2), lerp(4.9, 4.3, ep)); ct.set(sg * 1.3, 1.32, 0); break; }
      case 'gaze': cp.set(drift(0.25, 0.2) + lerp(-0.5, 0.5, cv), 1.5, lerp(5.0, 4.5, ep)); ct.set(0, 1.3, 0); break;
      case 'kiss': cp.set(drift(0.15, 0.2) + lerp(-0.4, 0.4, cv), 1.5, lerp(5.2, 4.6, ep)); ct.set(0, 1.4, 0); break;
      case 'leak': cp.set(-2.7 + drift(0.05, 0.2) + 0.5 * cv, lerp(0.85, 0.75, ep), lerp(3.75, 3.45, ep)); ct.set(-1.95, 0.36, 0.85); break;
      case 'nurse': cp.set(drift(0.08, 0.15) + lerp(-0.5, 0.5, cv), 1.5, lerp(9.9, 9.3, ep)); ct.set(0, 1.5, 0); break;
      case 'curtain': { const sg = s.side === 'him' ? 1 : -1; cp.set(sg * (3.6 + drift(0.08, 0.2)), 1.65, lerp(7.3, 6.7, ep)); ct.set(sg * -0.35, 1.38, 0); break; }
      case 'shelf': cp.set(lerp(-0.6, 0.6, cv) + 0.012 * Math.sin(t * 71), 0.95 + 0.01 * Math.sin(t * 83), lerp(8.9, 8.1, ep)); ct.set(0, 1.42, 0); break;
      case 'rows': { const x0 = -27 + 5 * cv, x = x0 + lerp(0, 8, p); cp.set(x, 1.9 + drift(0.03, 0.3), 5.6); ct.set(x + 8.5, 1.45, -0.6); fov = 40; break; }
      case 'empty': cp.set(lerp(-0.3, 0.3, cv), 1.5, lerp(6.9, 6.5, ep)); ct.set(0, 1.42, 0); break;
      case 'dusty': cp.set(-JX + drift(0.04, 0.15), 1.4, lerp(4.1, 3.6, ep)); ct.set(-JX, 1.42, 0); break;
    }
    switch (mode) {
      case 'her': case 'him': L.exp = 1.05; break;
      case 'gaze': L.key *= 0.8; break;
      case 'kiss': L.key *= 0.6; L.mid = Math.pow(bp, 1.4) * (0.5 + 0.7 * en); break;
      case 'nurse': { const u = 2 * p - 1, f = 0.5 + 0.5 * Math.sign(u) * Math.pow(Math.abs(u), 1.5);
        L.shX = lerp(-0.3, 1.3, f); L.shW = sstep(0, 0.08, p) * sstep(1, 0.92, p);
        L.handK = sstep(0.36, 0.5, p) * sstep(0.74, 0.62, p); L.handW = L.handK;
        L.key = 0.8; L.keyCol = [0.5, 0.66, 1.0]; L.keyDir = [-0.3, 0.3, 0.9]; L.wallK = 0.2; L.tube = 0; L.glowK = 0.5; L.nGlow *= 0.6; L.tint = [0.86, 0.96, 1.12]; L.env = 0.5; L.amb = 0.02;
        nursePt.set(lerp(-10, 10, f), 2.6, 9); break; }
      case 'lightson': { const o = lt >= 0.3 && !(lt >= 0.36 && lt < 0.44) && !(lt >= 0.5 && lt < 0.56);
        if (o) { L.key = 2.3; L.tube = 5; L.wallK = 0.4; L.amb = 0.1; L.keyCol = [0.84, 1.0, 0.9]; L.white = 0.03 + 0.6 * Math.exp(-Math.max(0, lt - 0.56) * 3.5); L.exp = 1.1; L.fog = 0.012; L.env = 2.5; L.eyeGlow = 0; L.bloom = 0.6; L.glowK = 0.8; }
        L.on = sstep(0.3, 0.42, lt); break; }
      case 'curtain': L.key *= 0.9; L.wallK = 0.03; break;
      case 'shelf': L.key *= 1; break;
      case 'rows': L.key = 0.3 * flick; L.tube = 0.25 * (hash(Math.floor(t * 13)) > 0.5 ? 1 : 0.2); L.fog = 0.043; L.nGlow = 1.0 * (0.85 + 0.15 * bp); L.eyeGlow = 0.35; showHeroes = false; nbMode = 'r'; L.env = 0.4; break;
      case 'empty': L.key = 0.55 * (hash(Math.floor(t * 11)) > 0.93 ? 0.55 : 1); L.keyCol = [0.6, 0.75, 1.0]; L.tube = L.key; L.glowK = 0.4; L.nGlow = 0.1; L.tint = [0.85, 0.95, 1.1]; L.env = 0.6;
        her.col.setRGB(0.5, 0.75, 0.6); him.col.setRGB(0.45, 0.72, 0.62); break;
      case 'dusty': L.key = 0.3; L.keyCol = [0.9, 0.85, 0.7]; L.tube = 0; L.nGlow = 0; L.wallK = 0.05; L.env = 0.3; showHim = false; nbMode = 'x';
        her.col.setRGB(0.85, 0.62, 0.2); her.level = 2.12; her.murk = 0.45; break;
      case 'dark': { const tube = p < 0.1 ? 1 : p < 0.36 ? (hash(Math.floor(t * 15) + 3) > 0.2 + 2.6 * (p - 0.1) ? 1 : 0.04) : 0;
        L.key = tube * 0.95; L.tube = tube; L.env = tube; L.amb = 0.012 * tube; L.wallK = 0.02 * tube;
        L.glowK = (1 - sstep(0.38, 0.72, p)) * (p > 0.5 && hash(Math.floor(t * 12) + 9) > 0.7 ? 0.6 : 1); L.nGlow *= 1 - sstep(0.3, 0.6, p); L.innerK = 1 - sstep(0.3, 0.6, p);
        L.eyeGlow = 0.05 + 0.6 * sstep(0.4, 0.72, p) - 0.65 * sstep(0.86, 0.96, p); L.glint = 1 + 3 * sstep(0.4, 0.72, p) - 4 * sstep(0.88, 0.97, p); L.fade = 1 - sstep(0.93, 0.985, p); L.dark = p; break; }
    }
    if (mode === 'shelf') { slide = 0.46 * sstep(0.04, 0.96, p); const mv = Math.sin(Math.PI * clamp(p)) > 0.05 ? 1 : 0;
      for (const h of heroes) h.g.position.set(-h.sgn * (JX - slide) + 0.006 * mv * Math.sin(t * 97 + h.i), 0.004 * mv * Math.sin(t * 113 + h.i * 2), 0); }
    if (mode === 'leak') her.level = her.level0 - 0.06 - 0.1 * p;
    camera.fov = fov; camera.position.copy(cp); camera.lookAt(ct); camera.updateProjectionMatrix(); camera.updateMatrixWorld();

    // ── acting ──
    for (const h of heroes) {
      const A = h.A, i = h.i, v = V[i], o = V[1 - i], sgn = h.sgn, ph = i * 2.1, jx = h.g.position.x;
      A.vis = showHeroes && (i === 0 || showHim); A.x = 0; A.z = 0; A.y = 0.05 * Math.sin(t * 1.1 + ph) + 0.04 * bp * en;
      A.yaw = sgn * 0.5 + 0.07 * Math.sin(t * 0.37 + ph); A.pitch = 0.04 * Math.sin(t * 0.8 + ph * 1.3); A.roll = 0.05 * Math.sin(t * 0.6 + ph);
      A.swell = 0.014 * bp * en; A.sy = 1; A.sz = 1; A.lookCam = 0; A.lookPt = null; A.jit = 0.05;
      A.lidUp = 0.62; A.lidLo = 0.8; A.tilt = 0; A.pupil = 0.42 + 0.22 * bp * en; A.lidK[0] = A.lidK[1] = 1;
      { const per = 3.3 + i * 0.8, k = Math.floor(t / per), tb = (k + 0.15 + 0.7 * hash2(k, i + sd)) * per, x = (t - tb) / 0.2; A.blink = x > 0 && x < 1 ? Math.pow(Math.sin(Math.PI * x), 0.6) : 0; }
      A.tailCurl = 0.55 + 0.2 * Math.sin(t * 0.7 + ph); A.tailWag = 0.1; A.tailSpd = 2.2; A.tremble = 0; A.eyeOut = 0; A.eyeX = 0; A.eyeY = 0;
      A.glow = 0.55 + 0.2 * bp * en + 0.08 * Math.min(1, on); A.inner = 0.05 + 0.2 * en * bp; A.twinkle = 0.3 + 0.9 * en; A.amp = 1; A.bub = 0.3 + 0.7 * en;
      A.perf = 1; A.listen = 1; A.tiltX = 0.012 * Math.sin(t * 1.7 + ph) + 0.012 * bp * beatSway; A.tiltZ = 0.01 * Math.sin(t * 1.3 + ph);
      const yawCam = Math.atan2(cp.x - jx, cp.z);
      switch (mode) {
        case 'wide': case 'dark': case 'lightson':
          A.yaw = sgn * (0.5 - 0.32 * v.lineK) + 0.07 * Math.sin(t * 0.37 + ph);
          A.lookCam = v.lineK > 0.5 ? glance(t, 1.9, sd + i, 0.62) : glance(t, 3.1, sd + i + 9, 0.18);
          if (mode === 'lightson') { const k = L.on || 0, rec = lt > 0.3 ? Math.exp(-(lt - 0.3) * 1.3) : 0;
            A.y -= 0.16 * k; A.pitch += 0.3 * k; A.lidUp = lerp(A.lidUp, 0.13, k); A.lidLo = lerp(A.lidLo, 0.2, k); A.pupil = lerp(A.pupil, 0, k); A.tilt = -0.25 * k; A.tremble = 0.014 * rec;
            A.tailCurl = lerp(A.tailCurl, 1.5, k); A.perf = 1 - 0.5 * k; A.lookCam = lerp(A.lookCam, 1, k); A.jit = 0.05 + 0.1 * rec; A.blink *= 1 - k; }
          if (mode === 'dark') { const f = sstep(0.1, 0.5, p); A.lidUp = lerp(0.62, 1.05, f); A.lidLo = lerp(0.8, 0.95, f); A.jit = 0.05 + 0.16 * f * (1 - sstep(0.7, 0.9, p)); A.tremble = 0.005 * f; A.pupil = lerp(A.pupil, 0.85, f);
            A.perf = 1 - sstep(0.3, 0.55, p); A.x = sgn * 0.2 * f; A.yaw = lerp(A.yaw, sgn * 0.75, sstep(0.3, 0.7, p)); A.lookCam *= 1 - sstep(0.5, 0.8, p); A.tailCurl = lerp(A.tailCurl, 1.3, f); A.blink *= 1 - f; }
          break;
        case 'her': case 'him':
          if ((mode === 'her') === (i === 0)) { A.yaw = yawCam + sgn * 0.42 + 0.1 * Math.sin(t * 0.5); A.lookCam = 1 - glance(t, 2.3, sd + 3, 0.2); A.perf = 1.35; A.lidUp = 0.72; A.jit = 0.035; }
          else { A.yaw = sgn * 1.0; A.x = sgn * 0.14; }
          break;
        case 'gaze': A.yaw = sgn * (1.0 + 0.06 * Math.sin(t * 0.4 + ph)); A.x = sgn * (0.2 + 0.05 * Math.sin(t * 0.5 + ph)); A.jit = 0.03; A.lidUp = 0.5; A.lidLo = 0.68; A.pupil = 0.72 + 0.25 * bp;
          A.tailWag = 0.2; A.tailCurl = 0.8; A.perf = 0.8; A.roll += sgn * 0.08; A.eyeOut = 0.08; break;
        case 'kiss': A.yaw = sgn * 1.42; A.x = sgn * (0.3 + 0.03 * bp); A.sz = 0.84 - 0.05 * bp; A.roll = 0.24 + 0.03 * Math.sin(t * 0.8); A.pitch = -0.06; A.lidUp = A.lidLo = -0.04; A.blink = 0;
          A.tremble = 0.004 + 0.007 * bp; A.tailCurl = 1.35 + 0.15 * bp; A.tailWag = 0.06; A.glow += 0.4 * bp; A.inner += 0.7 * bp; A.twinkle += 2 * bp; A.perf = 0.5; A.listen = 0; A.y *= 0.4; break;
        case 'leak':
          if (i === 0) { A.x = Math.sin(CRACK_AZ) * 0.2; A.z = Math.cos(CRACK_AZ) * 0.2; A.y = -0.42 + 0.03 * Math.sin(t * 1.3); A.yaw = CRACK_AZ - 0.35; A.pitch = 0.22; A.roll = -0.12;
            A.lookPt = tmp2.set(-JX + Math.sin(CRACK_AZ + 0.04) * 1.05, 0.2 + 0.5 * glance(t, 1.6, sd + 2, 0.5), 1.0); A.lookCam = glance(t, 2.7, sd + 4, 0.3);
            A.tilt = 0.4; A.lidUp = 1.0; A.lidLo = 0.9; A.pupil = 0.2 + 0.1 * bp; A.tremble = 0.006; A.tailCurl = 1.3; A.jit = 0.07; A.perf = 0.6; A.eyeY = -0.25; A.eyeOut = 0.1; A.listen = 0; }
          else { A.x = -0.24; A.yaw = -1.15; A.tilt = 0.32; A.lidUp = 0.85; A.perf = 0.6; }
          break;
        case 'nurse': A.y *= 0.15; A.y -= 0.05; A.yaw = sgn * 0.3; A.pitch = 0; A.roll = 0; A.lookPt = nursePt; A.jit = 0.012; A.lidUp = 1.15; A.lidLo = 1.0; A.pupil = 0.1; A.blink = 0; A.tremble = 0.005;
          A.tailCurl = 0.05; A.tailWag = 0.006; A.perf = 0.12; A.listen = 0; A.bub = 0.12; A.amp = 0.2; A.swell = 0; A.inner = 0.04; A.twinkle = 0.1; A.glow = 0.7;
          { const d = Math.abs((jx / 8.6 + 0.5) - L.shX), near = sstep(0.22, 0.02, d); A.y -= 0.1 * near; A.sy = 1 - 0.05 * near; A.tilt = 0.3; } break;
        case 'curtain': { const ck = sstep(0.5, 1.6, lt);
          A.yaw = sgn * lerp(0.95, 1.22, ck); A.x = sgn * 0.2 * ck; A.y -= 0.07 * ck; A.lidUp = lerp(0.8, 0.48, ck); A.tilt = 0.4 * ck; A.pupil = 0.5; A.tailCurl = lerp(0.6, 0.18, ck); A.tailWag = 0.03; A.perf = 0.6; A.jit = 0.03;
          if (ck > 0.3) A.lookPt = (i ? tmp : tmp2).set(sgn * -0.02, 1.35 + 0.25 * hold(t, 1.4, sd + i), 0.2 + 0.5 * hold(t, 1.4, sd + i + 5)); A.roll = -sgn * 0.12 * ck; break; }
        case 'shelf': { const ex = 0.5 + 0.5 * p;
          A.y += 0.1 * ex * Math.abs(beatSway) * (0.4 + 0.6 * en); A.yaw = sgn * 1.12; A.x = sgn * 0.2 * ex; A.lidUp = 1.0; A.lidLo = 0.92; A.pupil = 0.8 + 0.2 * bp; A.tailWag = 0.4; A.tailSpd = 9; A.tailCurl = 0.7;
          A.twinkle += 2.5; A.inner += 0.5 * ex; A.glow += 0.25 * ex; A.tremble = 0.004; A.eyeOut = 0.1; A.roll = 0.1 * beatSway;
          const mv = Math.sin(Math.PI * p); A.tiltX = 0.07 * mv * Math.sin(t * 7.3 + i * 2) + sgn * 0.05 * mv; A.tiltZ = 0.04 * mv * Math.sin(t * 5.9 + i); break; }
        case 'dusty': { const o0 = s.open ?? dur * 0.35, op = sstep(o0, o0 + 2.4, lt);
          A.y = 0.1 + 0.012 * Math.sin(t * 0.6); A.yaw = 0.3; A.pitch = 0.12; A.roll = 0.12; A.z = 0.12; A.eyeOut = 0.12; A.lidK[1] = op; A.lidK[0] = 0.5 * sstep(o0 + 1.2, o0 + 4.5, lt); A.lidUp = 0.82; A.lidLo = 0.85;
          A.lookCam = 1; A.pupil = lerp(0.05, 0.75, sstep(o0 + 1.0, o0 + 3.6, lt)); A.blink = 0; A.jit = 0.012 * op; A.tailCurl = 0.02; A.tailWag = 0.004; A.glow = 0.3 + 0.3 * op; A.inner = 0.02 + 0.35 * op * (0.6 + 0.4 * bp);
          A.twinkle = 0.05 + 0.6 * op; A.perf = 0; A.listen = 0; A.bub = 0.04; A.amp = 0.1; A.swell = 0.02 * op * bp; A.tiltX = A.tiltZ = 0; break; }
        case 'empty': A.vis = false; A.glow = 0.55 + 0.05 * Math.sin(t * 0.9 + i); A.bub = 0.1; A.amp = 0.15; A.perf = 0; A.listen = 0; A.tiltX = A.tiltZ = 0; break;
        case 'rows': A.vis = false; break;
      }
      // performance: swell, nod and sway on the words; glow from inside
      const k = v.lineK * A.perf, sng = v.sing * A.perf, wp = v.wp * A.perf;
      A.swell += 0.05 * sng + 0.055 * wp; A.sy *= 1 + 0.09 * wp - 0.03 * sng; A.y += 0.08 * wp + 0.02 * k; A.pitch += 0.17 * wp - 0.1 * k; A.roll += 0.14 * k * beatSway;
      A.glow += 0.32 * sng + 0.34 * wp; A.inner += 0.55 * sng + 0.5 * wp; A.twinkle += 2.2 * sng; A.pupil += 0.15 * k + 0.1 * wp; if (A.lidUp > 0.2) A.lidUp += 0.3 * wp + 0.08 * k;
      A.tailWag += 0.22 * k; A.tailSpd += 4 * k; A.bub = Math.min(1, A.bub + 0.3 * k);
      // listening: lean in
      const lk = o.lineK * A.listen * (1 - v.lineK);
      A.x += sgn * 0.13 * lk; A.roll += -sgn * 0.1 * lk; A.yaw += sgn * 0.4 * lk; A.pupil += 0.18 * lk; A.pitch -= 0.05 * lk;
      A.glow *= L.glowK; A.inner *= (0.3 + 0.7 * Math.min(1, L.glowK)) * L.innerK; A.twinkle *= L.innerK;
      A.tiltX += -A.x * 0.05;
      eu.set(0, A.yaw, 0); h.face.set(jx + A.x + Math.sin(A.yaw) * 0.4, BY + A.y - 0.1, A.z + Math.cos(A.yaw) * 0.4);
    }
    for (const h of heroes) { const A = h.A, other = heroes[1 - h.i];
      A.look = (A.look || V3()).copy(A.lookPt || other.face); if (A.lookCam > 0) A.look.lerp(cp, A.lookCam); }

    // ── globals ──
    const kc = L.keyCol, kk = L.key * 1.1;
    G.uKeyCol.value.setRGB(kc[0] * kk, kc[1] * kk, kc[2] * kk); G.uKeyDir.value.set(...L.keyDir).normalize(); G.uAmb.value.setRGB(L.amb * 0.9, L.amb, L.amb);
    G.uFogD.value = scene.fog.density = L.fog; G.uGlint.value = Math.max(0, L.glint); G.uEyeGlow.value = L.eyeGlow;
    keyLight.color.setRGB(kc[0], kc[1], kc[2]); keyLight.intensity = Math.PI * kk; keyLight.position.copy(ct).addScaledVector(G.uKeyDir.value, 10); keyLight.target.position.copy(ct); keyLight.target.updateMatrixWorld();
    scene.environmentIntensity = 0.28 * L.env * (0.2 + 0.8 * Math.min(1.5, L.tube));
    room.tubeMat.color.setRGB(0.8, 1, 0.93).multiplyScalar(0.02 + L.tube * 3.2);
    const RU = room.U; RU.uWallK.value = L.wallK; RU.uTubeK.value = L.tube;
    RU.uGA.value.set(her.g.position.x, 1.1, 0, her.A.glow * 0.06 * (showHeroes ? 1 : 0)); RU.uGB.value.set(him.g.position.x, 1.1, 0, him.A.glow * 0.06 * (showHeroes && showHim ? 1 : 0)); RU.uCA.value.copy(her.col); RU.uCB.value.copy(him.col);
    RU.uMid.value.setRGB(1.0, 0.45, 0.5).multiplyScalar(L.mid * 0.12);
    const PU = post.U; PU.uExp.value = L.exp; PU.uBloom.value = L.bloom; PU.uWhite.value = L.white; PU.uFade.value = L.fade; PU.uTint.value.setRGB(...L.tint);
    PU.uSh.value.set(L.shX || 0, 1.5, 0.16, L.shW * 0.95); PU.uHand.value.set(lerp(1.15, 0.62, L.handK || 0) + (L.shX || 0) * 0.1 - 0.05, 0.62, 1.05, L.handW * 0.9);

    // ── heroes ──
    for (const h of heroes) { h.g.visible = showHeroes && (h.i === 0 || showHim); if (h.g.visible) poseHero(h, t, bt, sd); else { for (let e = 0; e < 2; e++) eyes.set(h.i * 2 + e, tmp.set(0, -60, 0), eq.identity(), 0.0001, gz.set(0, 0, 1), 0, 0, 0, 0, under); } }
    eyes.done();
    her.glass.uniforms.uDust.value = mode === 'dusty' ? 0.7 : 0;

    // ── props ──
    web.visible = mode === 'dusty'; label.visible = mode === 'empty';
    const keyLum = L.key * 0.9 + 0.03 * Math.min(1, L.tube + L.glowK);
    crackMat.color.setRGB(0.55, 0.7, 0.66).multiplyScalar(keyLum * 1.7).add(c1.copy(her.col).multiplyScalar(her.A.glow * 0.25));
    wetMat.uniforms.uUnder.value.copy(her.col).multiplyScalar(her.A.glow * 0.7);
    { // the drop: swells under the tape, runs down the glass in fits, lands on the shelf every four beats
      const per = 4 * BEAT, x = (t - BEAT0) / per, k = Math.floor(x), f = x - k;
      const run = f < 0.3 ? 0 : sstep(0.3, 1.0, f) * 0.6 + 0.4 * Math.pow(clamp((f - 0.3) / 0.7), 3);
      streakPt(run * 0.98, tmp); drop.position.copy(tmp).addScaledVector(tmp2.set(tmp.x, 0, tmp.z).normalize(), 0.012);
      const ds = 0.016 + 0.014 * sstep(0, 0.3, f); drop.scale.set(ds, ds * (1.25 + 0.5 * run), ds);
      dropMat.emissiveIntensity = 1.1 * her.A.glow;
      const grow = mode === 'leak' ? 0.3 + 0.16 * p : 0.26; puddle.scale.setScalar(grow * (1 + 0.03 * Math.exp(-f * 5)));
      puddleMat.emissiveIntensity = 0.16 * her.A.glow;
      ripple.scale.setScalar(0.03 + f * 0.42); ringMat.color.copy(her.col).multiplyScalar(0.5 * Math.exp(-f * 4.5) * (0.3 + keyLum));
      ripple.visible = f < 0.8;
    }
    // kiss light
    kissGlow.visible = arcs.visible = mode === 'kiss';
    if (mode === 'kiss') { const a = L.mid; kissMat.color.setRGB(1.0, 0.45, 0.55).multiplyScalar(a * 2.2); kissGlow.scale.set(0.35 + 0.25 * a, 0.5 + 0.5 * a, 1);
      const P = arcGeo.attributes.position, fr = Math.floor(t * 30 + 0.5), x0 = her.g.position.x + R + 0.01, x1 = him.g.position.x - R - 0.01; let n = 0;
      for (let b = 0; b < 2; b++) { let px = x0, py = 1.5 + (hash2(fr, b) - 0.5) * 0.8, pz = 0.25;
        for (let k = 1; k <= 8; k++) { const f = k / 8, nx = lerp(x0, x1, f), ny = lerp(py, 1.5 + (hash2(fr, b + 3) - 0.5) * 0.8, 0.3) + (k < 8 ? (hash2(fr * 9 + k, b) - 0.5) * 0.28 : 0), nz = 0.25 + (hash2(fr * 7 + k, b + 5) - 0.5) * 0.2;
          P.setXYZ(n++, px, py, pz); P.setXYZ(n++, nx, ny, nz); px = nx; py = ny; pz = nz; } }
      P.needsUpdate = true; arcGeo.setDrawRange(0, n); arcMat.color.setRGB(1, 0.75, 0.85).multiplyScalar(bp > 0.45 ? 2.5 * bp : 0); }
    // curtain
    curtain.group.visible = mode === 'curtain';
    if (mode === 'curtain') { const far = cp.x < 0 ? him : her, near = cp.x < 0 ? her : him, CU = curtain.U;
      CU.uClose.value = sstep(0, 1.5, lt) * 0.97 + 0.03 * sstep(1.5, 3, lt); CU.uSwing.value = lt < 1.5 ? lt / 1.5 : Math.exp(-(lt - 1.5) * 1.1);
      CU.uFar.value.set(far.g.position.x, BY + far.A.y, far.A.z, far.A.glow * (1 + 0.5 * far.A.swell * 10)); CU.uFarCol.value.copy(far.col); CU.uFarLevel.value = far.level; CU.uNearCol.value.copy(near.col).multiplyScalar(near.A.glow); }

    // ── neighbours ──
    const pk = nbMode; if (pk !== placed) { nb.place(nbMode === 'r', nbMode === 'x'); placed = pk; }
    nb.nGlow.value = L.nGlow; nb.lampMat.color.setScalar(L.nGlow * 2.2); nb.poolMat.color.setScalar(L.nGlow * 2.2);
    nb.meshes.brain.material.userData.u.uUnderCol.value.setRGB(0.5, 0.9, 0.3).multiplyScalar(L.nGlow * 0.9); nb.meshes.brain.material.userData.u.uInner.value = 0.05; nb.meshes.brain.material.userData.u.uTwinkle.value = 0.2 + en;
    const rows = mode === 'rows', x0 = cp.x - lerp(0, 8, p), T = Math.min(dur * 0.7, 7);
    for (const [i, sl] of nb.slots.entries()) {
      const vis = nbMode !== 'x' && (!sl.hero || rows) && sl.kind !== 2;
      let w = 0; if (rows) { const tw = 0.7 + clamp((sl.x - x0 - 3) / 20) * T + hash2(i, 3) * 0.3 + Math.abs(sl.y) * 0.03; w = sstep(tw, tw + 0.28, lt); }
      nb.lg[i * 2 + 1] = sl.glow * (1 + 1.1 * w);
      under.copy(sl.col).multiplyScalar(L.nGlow * sl.glow * 1.5 * (1 + w));
      for (let e = 0; e < 2; e++) {
        if (!vis) { nb.eyes.set(i * 2 + e, tmp.set(0, -60, 0), eq.identity(), 0.0001, gz.set(0, 0, 1), 0, 0, 0, 0, under); continue; }
        const yaw = sl.yaw, lx = (e ? 0.36 : -0.36) * sl.bs, lz = 0.9 * sl.bs, cy = Math.cos(yaw), sy = Math.sin(yaw);
        epos.set(sl.x + lx * cy + lz * sy, sl.y + sl.by - 0.1 * sl.bs + 0.02 * Math.sin(t * 1.1 + sl.ph + e), -lx * sy + lz * cy);
        sf.set(sy, 0, cy); tmp.copy(cp).sub(epos).normalize(); sf.lerp(tmp, 0.7 * w).normalize();
        em.lookAt(sf, ZERO, UP); eq.setFromRotationMatrix(em); gz.copy(w > 0 ? tmp : sf).applyQuaternion(eq.clone().invert());
        nb.eyes.set(i * 2 + e, epos, eq, 0.13, gz, lerp(-0.04, 1.1, w), lerp(-0.04, 0.95, w), 0, 0.15 + 0.55 * sstep(0.5, 1, w) + 0.15 * bp * w, under);
      }
    }
    nb.aLG.needsUpdate = true; nb.eyes.done();
  }

  return { scene, camera, update, render(r, target) { post.render(r, scene, camera, target); } };
}

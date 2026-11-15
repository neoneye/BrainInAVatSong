// figure.js: a mannequin with a brain for a head. Torso is a small FK chain (hips → chest → head); arms and legs are
// two-bone IK solved in root-local space, drawn as cylinders stretched between joints. Everything is posed from a plain
// pose object each frame, so the figure is a pure function of the pose.
import * as THREE from 'three';
import { brainGeo } from './brain.js';

const Y = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _d = V(), _c = V(), _t = V(), _p = V(), _x = V(), _y = V(), _z = V(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();

function seg(mesh, a, b) {
  _d.subVectors(b, a); const l = _d.length() || 1e-4;
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y, _d.multiplyScalar(1 / l));
  mesh.scale.set(1, l, 1);
}
// two-bone IK: joint and (clamped) end for a chain a → t with lengths l1, l2, bending towards `pole`
function ik(a, t, l1, l2, pole, outJ, outE) {
  _d.subVectors(t, a); const L = _d.length() || 1e-4;
  const Lc = Math.min((l1 + l2) * 0.999, Math.max(Math.abs(l1 - l2) + 0.01, L)); _d.multiplyScalar(1 / L);
  const ca = (l1 * l1 + Lc * Lc - l2 * l2) / (2 * l1 * Lc), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  _c.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_c.lengthSq() < 1e-6) { _c.set(0, 0, 1).addScaledVector(_d, -_d.z); if (_c.lengthSq() < 1e-6) _c.set(1, 0, 0); }
  _c.normalize();
  outJ.copy(a).addScaledVector(_d, l1 * ca).addScaledVector(_c, l1 * sa);
  outE.copy(a).addScaledVector(_d, Lc);
}

export const HIPY = 0.98, CHEST = 0.13, SHY = 0.37, UP = 0.29, FORE = 0.26, THIGH = 0.45, SHIN = 0.45, ANKLE = 0.07, HIPW = 0.095;

export function makeFigure(o) {
  const F = o.female, k = F ? 0.86 : 1, SHW = F ? 0.165 : 0.2, NECK = F ? 0.40 : 0.44;
  const phong = (color, extra = {}) => new THREE.MeshPhongMaterial({ color, shininess: 55, specular: 0x444444, ...extra });
  const mats = {
    skin: phong(o.skin), top: phong(o.top, o.topMap ? { map: o.topMap, color: 0xffffff } : {}), bottom: phong(o.bottom),
    brain: new THREE.MeshPhongMaterial({ color: o.brain, vertexColors: true, shininess: 35, specular: 0x333333 }),
    eye: phong(0xffffff, { shininess: 120, specular: 0xffffff }), iris: phong(o.iris, { shininess: 100 }), pupil: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    stalk: phong(o.stalk),
  };
  const all = [];
  const mesh = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); parent.add(m); all.push(m); return m; };
  const sph = (r, mat, parent, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0) => { const m = mesh(new THREE.SphereGeometry(r, 14, 10), mat, parent); m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m; };
  const cyl = (rTop, rBot, mat, parent, h = 1, open = false) => mesh(new THREE.CylinderGeometry(rTop, rBot, h, 12, 1, open), mat, parent);

  const root = new THREE.Group(); root.rotation.order = 'YXZ'; root.scale.setScalar(o.scale || 1);
  const hips = new THREE.Group(), chest = new THREE.Group(), head = new THREE.Group();
  head.rotation.order = 'YXZ'; chest.rotation.order = 'YXZ'; hips.rotation.order = 'YXZ';
  root.add(hips); hips.add(chest); chest.add(head);

  // torso
  const shirt = [];   // meshes that make up his shirt (hidden when it is off)
  let skirt = null;
  if (F) {
    sph(1, mats.top, hips, 0.15, 0.125, 0.115, 0, -0.01, 0);
    const bod = cyl(0.148, 0.105, mats.top, chest, 0.31); bod.position.y = 0.145; bod.scale.z = 0.7;
    sph(1, mats.top, chest, 0.108, 0.06, 0.078, 0, -0.005, 0);
    sph(1, mats.skin, chest, 0.17, 0.085, 0.098, 0, 0.325, 0);
    sph(0.064, mats.top, chest, 1, 1, 0.9, 0.066, 0.245, 0.078); sph(0.064, mats.top, chest, 1, 1, 0.9, -0.066, 0.245, 0.078);
    skirt = mesh(new THREE.CylinderGeometry(0.118, 0.31, 0.52, 16, 1, true), mats.top, hips); skirt.material = mats.top.clone(); skirt.material.side = THREE.DoubleSide;
    skirt.position.y = -0.17; skirt.scale.z = 0.82;
  } else {
    sph(1, mats.bottom, hips, 0.17, 0.13, 0.122, 0, -0.01, 0);
    const tor = cyl(0.192, 0.14, mats.skin, chest, 0.4); tor.position.y = 0.19; tor.scale.z = 0.62;
    sph(1, mats.skin, chest, 0.142, 0.08, 0.09, 0, -0.005, 0);
    sph(1, mats.skin, chest, 0.215, 0.075, 0.118, 0, 0.385, 0);
    sph(0.085, mats.skin, chest, 1, 0.75, 0.5, 0.085, 0.3, 0.085); sph(0.085, mats.skin, chest, 1, 0.75, 0.5, -0.085, 0.3, 0.085);
    const st = cyl(0.21, 0.172, mats.top, chest, 0.47, true); st.position.y = 0.165; st.scale.z = 0.7; st.material = mats.top.clone(); st.material.side = THREE.DoubleSide; shirt.push(st); mats.top2 = st.material;
    shirt.push(sph(1, mats.top, chest, 0.238, 0.088, 0.142, 0, 0.385, 0));
  }

  // limbs
  const arm = s => {
    const a = { s, sh: V(), el: V(), wr: V() };
    a.upper = cyl(0.041 * k, 0.05 * k, mats.skin, root); a.fore = cyl(0.032 * k, 0.041 * k, mats.skin, root);
    a.jS = sph(0.056 * k, mats.skin, root); a.jE = sph(0.042 * k, mats.skin, root);
    if (!F) { a.sleeve = cyl(0.066, 0.07, mats.top, root); a.cap = sph(0.073, mats.top, root); shirt.push(a.sleeve, a.cap); }
    // hand: y = towards the fingertips, z = palm normal
    const h = a.hand = new THREE.Group(); root.add(h);
    sph(1, mats.skin, h, 0.043 * k, 0.052 * k, 0.019 * k, 0, 0.05 * k, 0);
    a.fingers = [];
    const finger = (x, y, l1, l2, r) => {
      const g1 = new THREE.Group(), g2 = new THREE.Group(); g1.position.set(x, y, 0); g2.position.y = l1; h.add(g1); g1.add(g2);
      const c1 = new THREE.CapsuleGeometry(r, l1, 2, 8); c1.translate(0, l1 / 2, 0); mesh(c1, mats.skin, g1);
      const c2 = new THREE.CapsuleGeometry(r * 0.9, l2, 2, 8); c2.translate(0, l2 / 2, 0); mesh(c2, mats.skin, g2);
      return { g1, g2 };
    };
    const th = finger(-s * 0.04 * k, 0.022 * k, 0.04 * k, 0.03 * k, 0.0125 * k); a.fingers.push(th);
    [[-0.031, 0.092, 0.04, 0.03], [-0.0105, 0.098, 0.045, 0.034], [0.0105, 0.096, 0.042, 0.032], [0.031, 0.088, 0.034, 0.026]].forEach(([x, y, l1, l2]) => a.fingers.push(finger(-s * x * k, y * k, l1 * k, l2 * k, 0.0105 * k)));
    return a;
  };
  const leg = s => {
    const l = { s, hp: V(), kn: V(), an: V() };
    l.thigh = cyl(0.057 * k, 0.078 * k, mats.skin, root); l.shin = cyl(0.039 * k, 0.055 * k, mats.skin, root);
    l.jK = sph(0.057 * k, mats.skin, root); l.jH = sph(0.08 * k, F ? mats.top : mats.bottom, root);
    if (!F) l.shorts = cyl(0.092, 0.094, mats.bottom, root);
    l.foot = new THREE.Group(); l.foot.rotation.order = 'YXZ'; root.add(l.foot);
    sph(1, mats.skin, l.foot, 0.047 * k, 0.04 * k, 0.115 * k, 0, -0.03, 0.06 * k); sph(0.045 * k, mats.skin, l.foot);
    return l;
  };
  const armL = arm(1), armR = arm(-1), legL = leg(1), legR = leg(-1);

  // head: neck, brain, two eyes on stalks
  const S = o.brainSize || 0.25, BC = V(0, 0.2, 0.035);
  const neck = cyl(0.05 * k, 0.06 * k, mats.skin, head, 0.16); neck.position.y = 0.04;
  const brain = mesh(brainGeo(o.seed, 40), mats.brain, head); brain.position.copy(BC); brain.scale.setScalar(S);
  const ER = 0.062;
  const eye = s => {
    const e = { s, g: new THREE.Group(), segs: [], base: V(s * 0.065, 0.1, 0.195).multiplyScalar(S / 0.25).add(BC) };
    e.g.rotation.order = 'YXZ'; head.add(e.g);
    e.ball = mesh(new THREE.SphereGeometry(ER, 16, 12), mats.eye, e.g);
    const iris = mesh(new THREE.SphereGeometry(ER * 1.012, 14, 4, 0, Math.PI * 2, 0, 0.62), mats.iris, e.g); iris.rotation.x = Math.PI / 2;
    e.pupil = mesh(new THREE.SphereGeometry(ER * 1.024, 12, 3, 0, Math.PI * 2, 0, 0.33), mats.pupil, e.g); e.pupil.rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) e.segs.push(cyl(0.015, 0.017, mats.stalk, head));
    e.joints = [1, 2, 3, 4].map(() => sph(0.0165, mats.stalk, head));
    return e;
  };
  const eyeL = eye(1), eyeR = eye(-1);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 2;

  const inv = new THREE.Matrix4(), Mc = new THREE.Matrix4(), pts = [V(), V(), V(), V(), V(), V()];
  const fig = { root, hips, chest, head, mats, all, shadow, armL, armR, legL, legR, skirt, female: F, scale: o.scale || 1, shirtOn: true, fp: false };

  // world position of a point given in a body part's local frame (valid after core())
  fig.wp = (part, x, y, z, out = V()) => out.set(x, y, z).applyMatrix4((part === 'root' ? root : fig[part]).matrixWorld);
  fig.toLocal = (w, out = V()) => out.copy(w).applyMatrix4(inv);
  fig.dirLocal = (w, out = V()) => out.copy(w).transformDirection(inv);
  fig.brainW = (out = V()) => fig.wp('head', BC.x, BC.y, BC.z, out);

  fig.core = p => {
    root.position.set(p.pos[0], p.pos[1], p.pos[2]); root.rotation.set(p.pitch || 0, p.yaw || 0, p.roll || 0);
    const h = p.hip || [0, 0, 0], hr = p.hipR || [0, 0, 0], cr = p.chestR || [0, 0, 0], er = p.headR || [0, 0, 0];
    hips.position.set(h[0], HIPY + h[1], h[2]); hips.rotation.set(hr[0], hr[1], hr[2]);
    chest.position.set(0, CHEST, 0); chest.rotation.set(cr[0], cr[1], cr[2]);
    head.position.set(0, NECK, 0); head.rotation.set(er[0], er[1], er[2]);
    root.updateMatrixWorld(true); inv.copy(root.matrixWorld).invert();
    Mc.multiplyMatrices(hips.matrix, chest.matrix);
  };

  const doArm = (a, sp = {}) => {
    const s = a.s;
    a.sh.set(s * SHW, SHY, 0).applyMatrix4(Mc);
    if (sp.w) _t.copy(sp.w).applyMatrix4(inv);
    else if (sp.l) _t.set(sp.l[0], sp.l[1], sp.l[2]);
    else { const r = sp.rel || [s * 0.05, -0.53, 0.05]; _t.set(s * SHW + r[0], SHY + r[1], r[2]).applyMatrix4(Mc); }
    const pl = sp.pole || [s * 0.5, -0.25, -1]; _p.set(pl[0], pl[1], pl[2]);
    ik(a.sh, _t, UP, FORE, _p, a.el, a.wr);
    seg(a.upper, a.sh, a.el); seg(a.fore, a.el, a.wr); a.jS.position.copy(a.sh); a.jE.position.copy(a.el);
    if (a.sleeve) { _t.lerpVectors(a.sh, a.el, 0.62); seg(a.sleeve, a.sh, _t); a.cap.position.copy(a.sh); }
    // hand frame
    if (sp.dir) _y.set(sp.dir[0], sp.dir[1], sp.dir[2]).normalize(); else _y.subVectors(a.wr, a.el).normalize();
    const pm = sp.palm || [-s, 0, 0.25]; _z.set(pm[0], pm[1], pm[2]); _z.addScaledVector(_y, -_z.dot(_y));
    if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    _z.normalize(); _x.crossVectors(_y, _z);
    a.hand.position.copy(a.wr); a.hand.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    const cu = sp.curl ?? 0.3;
    for (let i = 0; i < 5; i++) {
      const c = Array.isArray(cu) ? cu[i] : cu, f = a.fingers[i];
      if (i === 0) { f.g1.rotation.set(c * 0.5, 0, s * (1.0 - 0.45 * c)); f.g2.rotation.set(c * 0.9, 0, 0); }
      else { f.g1.rotation.set(c * 1.35, 0, -s * (i - 2.5) * 0.07 * (1 - c)); f.g2.rotation.set(c * 1.6, 0, 0); }
    }
  };
  const doLeg = (l, sp = {}) => {
    const s = l.s;
    l.hp.set(s * HIPW, -0.04, 0).applyMatrix4(hips.matrix);
    if (sp.w) _t.copy(sp.w).applyMatrix4(inv); else { const t = sp.l || [s * HIPW, ANKLE, 0]; _t.set(t[0], t[1], t[2]); }
    const pl = sp.pole || [s * 0.08, 0, 1]; _p.set(pl[0], pl[1], pl[2]);
    ik(l.hp, _t, THIGH, SHIN, _p, l.kn, l.an);
    seg(l.thigh, l.hp, l.kn); seg(l.shin, l.kn, l.an); l.jK.position.copy(l.kn); l.jH.position.copy(l.hp);
    if (l.shorts) { _t.lerpVectors(l.hp, l.kn, 0.6); seg(l.shorts, l.hp, _t); }
    l.foot.position.copy(l.an); l.foot.rotation.set(sp.pitch || 0, sp.yaw ?? s * 0.12, 0);
  };
  const doEye = (e, sp = {}) => {
    const s = e.s, wide = sp.wide || 0, ext = sp.ext || 0, tw = sp.twine || 0, g = sp.gaze || [0, 0];
    const off = sp.off || [0, 0, 0];
    // eye centre: forward-up-out from the base; twine pulls it across the midline and forward
    _t.set(s * 0.05 + s * off[0], 0.125 + 0.05 * ext + off[1], 0.1 + 0.2 * ext + off[2]).add(e.base);
    if (sp.w && tw > 0) { _m2.copy(head.matrixWorld).invert(); _p.copy(sp.w).applyMatrix4(_m2); _t.lerp(_p, tw); }
    e.g.position.copy(_t); e.g.rotation.set(-g[1], g[0] + s * 0.06, 0);
    e.g.scale.setScalar(1 + 0.5 * wide);
    const ps = (sp.pupil ?? 1) * (1 - 0.35 * wide); e.pupil.scale.set(ps, 1, ps);
    // stalk: quadratic curve base → eye, plus a helix when twined
    _d.subVectors(_t, e.base); const len = _d.length(); _d.multiplyScalar(1 / len);
    _x.set(1, 0, 0).addScaledVector(_d, -_d.x).normalize(); _y.crossVectors(_d, _x);
    const ph = sp.phase || 0;
    for (let i = 0; i <= 5; i++) {
      const u = i / 5, bow = Math.sin(Math.PI * u), a = ph + u * 7.5 + (s > 0 ? 0 : Math.PI);
      pts[i].copy(e.base).addScaledVector(_d, len * u);
      pts[i].y += -0.03 * bow * (1 - tw); pts[i].z += 0.035 * bow * (1 - tw);
      pts[i].addScaledVector(_x, Math.cos(a) * 0.045 * tw * bow).addScaledVector(_y, Math.sin(a) * 0.045 * tw * bow);
    }
    for (let i = 0; i < 5; i++) seg(e.segs[i], pts[i], pts[i + 1]);
    for (let i = 0; i < 4; i++) e.joints[i].position.copy(pts[i + 1]);
  };

  fig.limbs = p => {
    doArm(armL, p.armL); doArm(armR, p.armR); doLeg(legL, p.legL); doLeg(legR, p.legR);
    const e = p.eye || {};
    doEye(eyeL, e.L ? { ...e, ...e.L } : e); doEye(eyeR, e.R ? { ...e, ...e.R } : e);
    if (skirt) { const sk = p.skirt || [0, 0, 1]; skirt.rotation.set(sk[0], 0, sk[1]); skirt.scale.set(sk[2], 1, 0.82 * sk[2]); }
    if (!fig.fp) for (const m of all) m.visible = true;
    const on = fig.shirtOn && !fig.fp;
    for (const m of shirt) m.visible = on;
    if (fig.fp) { for (const m of all) m.visible = false; const a = fig.fpArm === 1 ? armL : armR; for (const m of [a.upper, a.fore, a.jE, a.jS]) m.visible = true; a.hand.traverse(x => { x.visible = true; }); }
    shadow.position.set(root.position.x, 0, root.position.z);
  };
  fig.resetVis = () => { for (const m of all) m.visible = true; };
  return fig;
}

// blend two poses that use the same fields (numbers / arrays / nested objects)
export function lerpPose(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => lerpPose(v, b[i], t));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !a.isVector3) { const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = k in a && k in b ? lerpPose(a[k], b[k], t) : (t < 0.5 ? a[k] ?? b[k] : b[k] ?? a[k]); return o; }
  return t < 0.5 ? a : b;
}

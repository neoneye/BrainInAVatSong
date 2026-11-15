// sim.js: everything precomputed for the shatter scene. Runs the fracture core (glasscore.js) on a specimen jar,
// then flies the pieces with a small rigid-body integrator (point contacts against the floor, no piece-to-piece
// contact) and records the poses, so any moment can be looked up directly. All of it is seeded and deterministic.
// The fracture model works at the size it was tuned for (a 110 mm jar); the picture scales it by S.
import C from './glasscore.js';

export const S = 2.3;
const PH = 0.110 * S, PR = 0.036 * S;
export const JAR = {
  R: PR, H: PH, wall: 0.0022 * S,
  Rp: PR + 0.012, hp: 0.024,          // dark plinth under the glass
  Rl: PR + 0.007, hl: 0.028,          // dark lid on top
  y0: 0.0035 * S, fill: 0.80 * PH,    // fluid from the base to this height (jar frame)
  labelPhi: Math.PI / 2, labelDphi: 1.75, labelY0: 0.26 * PH, labelY1: 0.68 * PH,
};
const G = 9.81;

const qrot = (q, v) => {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const cx = y * v[2] - z * v[1] + w * v[0], cy = z * v[0] - x * v[2] + w * v[1], cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
};
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qAxis = (ax, ang) => { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; };
export const Q = { qrot, qmul, qAxis };

// ---------------------------------------------------------------- the fall
// The jar tips over the shelf edge (pivoting on the corner of its plinth, the tilt growing like a falling
// pendulum), lets go, and falls turning until its lowest corner meets the floor at tau = 0.
// Jar frame: origin at the centre of the glass base, +y up the axis; the tilt th turns it about world z so that
// the +x side goes down.
export const SHELF = { y: 0.86, xe: -0.30 };
function fallTrajectory() {
  const k = 2.1, thRel = 0.75, om = k * thRel;
  const piv = [JAR.Rp, -JAR.hp], hc = 0.46 * JAR.H;
  const rot = (th, x, y) => [x * Math.cos(th) + y * Math.sin(th), -x * Math.sin(th) + y * Math.cos(th)];
  const Btip = th => { const r = rot(th, -piv[0], -piv[1]); return [SHELF.xe + r[0], SHELF.y + r[1]]; };
  const comOf = (B, th) => { const r = rot(th, 0, hc); return [B[0] + r[0], B[1] + r[1]]; };
  const cRel = comOf(Btip(thRel), thRel), e = 1e-5, c2 = comOf(Btip(thRel + e), thRel + e);
  const vRel = [(c2[0] - cRel[0]) / e * om, (c2[1] - cRel[1]) / e * om];
  const corners = [[JAR.Rp, -JAR.hp], [-JAR.Rp, -JAR.hp], [JAR.Rl, JAR.H + JAR.hl], [-JAR.Rl, JAR.H + JAR.hl]];
  const free = s => {
    const th = thRel + om * s, com = [cRel[0] + vRel[0] * s, cRel[1] + vRel[1] * s - 0.5 * G * s * s];
    const r = rot(th, 0, -hc);
    return { th, B: [com[0] + r[0], com[1] + r[1]] };
  };
  const low = s => { const f = free(s); let m = Infinity; for (const c of corners) { const r = rot(f.th, c[0], c[1]); m = Math.min(m, f.B[1] + r[1]); } return m; };
  let a = 0, b = 0; while (low(b) > 0) { a = b; b += 0.002; }
  for (let i = 0; i < 40; i++) { const m = 0.5 * (a + b); if (low(m) > 0) a = m; else b = m; }
  const tFall = a, hit = free(tFall);
  return {
    tFall, thHit: hit.th, om, B: [hit.B[0], hit.B[1], 0],
    vCom: [vRel[0], vRel[1] - G * tFall, 0], com: [...comOf(hit.B, hit.th), 0],
    at(tau) {   // pose for tau <= 0
      if (tau >= -tFall) { const f = free(Math.min(tau, 0) + tFall); return { th: f.th, B: [f.B[0], f.B[1], 0] }; }
      const th = thRel * Math.exp(k * (tau + tFall)), B = Btip(th);
      return { th, B: [B[0], B[1], 0] };
    },
  };
}

// ---------------------------------------------------------------- rigid bodies against the floor
// bodies: { x, q, v, w, pts (Float32Array, body frame), k2 (radius of gyration squared) }. Returns the recorded poses.
function simulate(bodies, { floorY, T, dt = 1 / 600, rec = 5, rest = 0.36, fric = 0.5 }) {
  const nb = bodies.length, steps = Math.ceil(T / dt), nF = Math.floor(steps / rec) + 1;
  const frames = new Float32Array(nF * nb * 7);
  const put = f => { for (let i = 0; i < nb; i++) { const b = bodies[i], o = (f * nb + i) * 7; frames[o] = b.x[0]; frames[o + 1] = b.x[1]; frames[o + 2] = b.x[2]; frames[o + 3] = b.q[0]; frames[o + 4] = b.q[1]; frames[o + 5] = b.q[2]; frames[o + 6] = b.q[3]; } };
  put(0);
  for (const b of bodies) { b.sleep = 0; b.asleep = false; b.invI = 1 / Math.max(2e-5, b.k2); }
  for (let s = 1; s <= steps; s++) {
    for (let i = 0; i < nb; i++) {
      const b = bodies[i]; if (b.asleep) continue;
      const x = b.x, q = b.q, v = b.v, w = b.w;
      v[1] -= G * dt;
      x[0] += v[0] * dt; x[1] += v[1] * dt; x[2] += v[2] * dt;
      // q += 0.5 dt (w ⊗ q)
      const qx = q[0], qy = q[1], qz = q[2], qw = q[3], h = 0.5 * dt;
      q[0] = qx + h * (w[0] * qw + w[1] * qz - w[2] * qy);
      q[1] = qy + h * (w[1] * qw + w[2] * qx - w[0] * qz);
      q[2] = qz + h * (w[2] * qw + w[0] * qy - w[1] * qx);
      q[3] = qw + h * (-w[0] * qx - w[1] * qy - w[2] * qz);
      const l = Math.hypot(q[0], q[1], q[2], q[3]); q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
      if (x[1] - b.rad > floorY) continue;
      let pen = 0, touch = false;
      const pts = b.pts, X = q[0], Y = q[1], Z = q[2], W = q[3], invI = b.invI;
      for (let p = 0; p < pts.length; p += 3) {
        const vx = pts[p], vy = pts[p + 1], vz = pts[p + 2];
        const cx = Y * vz - Z * vy + W * vx, cy = Z * vx - X * vz + W * vy, cz = X * vy - Y * vx + W * vz;
        const rx = vx + 2 * (Y * cz - Z * cy), ry = vy + 2 * (Z * cx - X * cz), rz = vz + 2 * (X * cy - Y * cx);
        const d = x[1] + ry - floorY;
        if (d >= 0) continue;
        touch = true; if (-d > pen) pen = -d;
        // velocity of the point
        const px = v[0] + w[1] * rz - w[2] * ry, py = v[1] + w[2] * rx - w[0] * rz, pz = v[2] + w[0] * ry - w[1] * rx;
        if (py >= 0) continue;
        // normal impulse (n = +y): r × n = (-rz, 0, rx)
        const e = py < -0.5 ? rest : 0;
        const jn = -(1 + e) * py / (1 + invI * (rz * rz + rx * rx));
        v[1] += jn; w[0] += invI * jn * -rz; w[2] += invI * jn * rx;
        // friction along the sliding direction t (in the floor plane): r × t = (ry tz, rz tx - rx tz, -ry tx)
        const sp = Math.hypot(px, pz);
        if (sp > 1e-6) {
          const tx = px / sp, tz = pz / sp;
          const ax = ry * tz, ay = rz * tx - rx * tz, az = -ry * tx;
          const jt = Math.min(fric * jn, sp / (1 + invI * (ax * ax + ay * ay + az * az)));
          v[0] -= jt * tx; v[2] -= jt * tz; w[0] -= invI * jt * ax; w[1] -= invI * jt * ay; w[2] -= invI * jt * az;
        }
      }
      if (touch) {
        x[1] += pen;
        const dw = 1 - 3.0 * dt, dv = 1 - 1.2 * dt;
        w[0] *= dw; w[1] *= dw; w[2] *= dw; v[0] *= dv; v[2] *= dv;
        if (Math.hypot(v[0], v[1], v[2]) < 0.07 && Math.hypot(w[0], w[1], w[2]) < 1.2) { b.sleep += dt; if (b.sleep > 0.1) { b.asleep = true; v.fill(0); w.fill(0); } }
        else b.sleep = 0;
      }
    }
    if (s % rec === 0) put(s / rec);
  }
  return { frames, nF, fdt: dt * rec, nb };
}

// ---------------------------------------------------------------- the model
// kind 'fall': the jar comes down off the shelf and lands on its side. kind 'burst': it stands still and cracks from
// a point on the front of the wall.
export function buildModel(kind, seed = 1) {
  const fall = kind === 'fall';
  const traj = fall ? fallTrajectory() : null;
  const thHit = fall ? traj.thHit : 0;
  const floorY = fall ? 0 : -0.62;
  const origin = fall ? null : { phi: JAR.labelPhi + 1.05, y: 0.036, r: 0.004 };
  let res = null;
  for (let tries = 0; tries < 6; tries++) {
    const P = { ...C.defaults(), shape: 'specimen', ...C.shapeDefaults('specimen'), floor: 'stone', scatter: 0, ring: 40, reach: 60, cell: 1,
      seed: 7 + seed * 13 + tries * 101, tilt: thHit * 180 / Math.PI, drop: fall ? 1.65 : 1.75 };
    if (origin) P.origin = origin;
    res = C.run(P, { mesh: true, minCells: 4 });
    const mid = res.pieces.filter(p => p.size > 0.008).length;
    if (res.imp.breaks && mid >= 60 && mid <= 420) break;
  }
  const { pieces, mesh, lines, imp, cr } = res, n = pieces.length;
  const T0 = Math.max(cr.tEnd, 1e-6);
  const rng = C.rngFrom(seed * 7919 + (fall ? 11 : 23));
  const gauss = () => C.gauss(rng);

  // the jar at the moment of the hit
  const qJ = [0, 0, Math.sin(-thHit / 2), Math.cos(-thHit / 2)];
  const B = fall ? traj.B : [0, 0, 0];
  const com = fall ? traj.com : [0, JAR.H * 0.46, 0];
  const vCom = fall ? traj.vCom : [0, 0, 0], omv = [0, 0, fall ? -traj.om : 0];
  const toW = p => { const r = qrot(qJ, p); return [B[0] + r[0], B[1] + r[1], B[2] + r[2]]; };
  const rigidV = x => { const r = [x[0] - com[0], x[1] - com[1], x[2] - com[2]]; return [vCom[0] + omv[1] * r[2] - omv[2] * r[1], vCom[1] + omv[2] * r[0] - omv[0] * r[2], vCom[2] + omv[0] * r[1] - omv[1] * r[0]]; };
  const axis = qrot(qJ, [0, 1, 0]);
  const originW = origin ? toW([JAR.R * Math.cos(origin.phi), origin.y * S, JAR.R * Math.sin(origin.phi)]) : toW(imp.seedCentre.map(c => c * S));

  // per piece: scaled centre, release time, vertex range, extreme points for the floor contact
  const comS = new Float32Array(n * 3), tRel = new Float32Array(n);
  for (let q = 0; q < n; q++) { comS[q * 3] = pieces[q].com[0] * S; comS[q * 3 + 1] = pieces[q].com[1] * S; comS[q * 3 + 2] = pieces[q].com[2] * S; tRel[q] = Math.min(1, pieces[q].tRel / T0); }
  const vStart = new Int32Array(n + 1);
  { const pc = mesh.piece; for (let i = 0; i < pc.length; i++) vStart[pc[i] + 1]++; for (let q = 0; q < n; q++) vStart[q + 1] += vStart[q]; }
  const DIRS = [];
  for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]]) { DIRS.push(a, a.map(x => -x)); }
  const extremes = q => {
    const pos = mesh.position, out = [], seen = new Set();
    let r2 = 0, k2 = 0, cnt = 0;
    for (const d of DIRS) {
      let best = -1, bd = -Infinity;
      for (let i = vStart[q]; i < vStart[q + 1]; i++) { const s = pos[i * 3] * d[0] + pos[i * 3 + 1] * d[1] + pos[i * 3 + 2] * d[2]; if (s > bd) { bd = s; best = i; } }
      if (best >= 0 && !seen.has(best)) { seen.add(best); out.push(pos[best * 3] * S, pos[best * 3 + 1] * S, pos[best * 3 + 2] * S); }
    }
    for (let i = 0; i < out.length; i += 3) { const d2 = out[i] * out[i] + out[i + 1] * out[i + 1] + out[i + 2] * out[i + 2]; r2 = Math.max(r2, d2); k2 += d2; cnt++; }
    return { pts: new Float32Array(out), rad: Math.sqrt(r2) + 0.002, k2: 0.3 * k2 / Math.max(1, cnt) };
  };

  // launch velocities
  const MAXB = 900;
  const order = [...pieces.keys()].filter(q => pieces[q].cells >= 4).sort((a, b) => pieces[b].cells - pieces[a].cells).slice(0, MAXB);
  const isBody = new Uint8Array(n); for (const q of order) isBody[q] = 1;
  const bodyPieces = order.slice().sort((a, b) => a - b);
  const launchOf = q => {
    const cl = [comS[q * 3], comS[q * 3 + 1], comS[q * 3 + 2]];
    const x = toW(cl), rr = Math.hypot(cl[0], cl[2]) || 1;
    const radial = qrot(qJ, [cl[0] / rr, 0, cl[2] / rr]);
    const lv = qrot(qJ, res.launch[q].v), ll = Math.hypot(lv[0], lv[1], lv[2]) || 1, lk = Math.min(ll, 4) / ll;
    const dO = Math.hypot(x[0] - originW[0], x[1] - originW[1], x[2] - originW[2]);
    let v;
    if (fall) {
      // the fluid bursts the wall outward; the half away from the floor is thrown up and out
      const rv = rigidV(x), k = 0.6 + 2.3 * rng(), up = radial[1] > -0.2 && rng() < 0.6 ? 0.8 + 2.6 * rng() : 0.2;
      v = [rv[0] + radial[0] * k + lv[0] * lk + 0.3 * gauss(), rv[1] * 0.6 + radial[1] * k + lv[1] * lk + 0.25 * gauss() + up, rv[2] + radial[2] * k * 1.2 + lv[2] * lk + 0.3 * gauss()];
    } else {
      const k = (0.7 + 1.9 * rng()) * (1 + 1.2 * Math.exp(-dO / 0.08));
      v = [radial[0] * k + lv[0] * lk * 0.5 + 0.3 * gauss(), 0.3 + 1.1 * rng() + lv[1] * lk * 0.5, radial[2] * k + lv[2] * lk * 0.5 + 0.5 + 1.3 * rng()];
    }
    const lw = res.launch[q].w, wl = Math.hypot(lw[0], lw[1], lw[2]) || 1, wk = Math.min(wl, 18) / wl;
    const w = [lw[0] * wk + 3 * gauss() + omv[0], lw[1] * wk + 3 * gauss() + omv[1], lw[2] * wk + 3 * gauss() + omv[2]];
    return { x, v, w };
  };
  const bodies = [];
  for (const q of bodyPieces) { const L = launchOf(q), ex = extremes(q); bodies.push({ x: L.x, q: qJ.slice(), v: L.v, w: L.w, pts: ex.pts, rad: ex.rad, k2: ex.k2 }); }
  // lid and plinth: short cylinders, contact points on both rims
  const disc = (R, h, yc, v, w) => {
    const pts = []; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.2832; pts.push(R * Math.cos(a), h / 2, R * Math.sin(a), R * Math.cos(a), -h / 2, R * Math.sin(a)); }
    const x = toW([0, yc, 0]), rv = rigidV(x);
    return { x, q: qJ.slice(), v: [rv[0] + v[0], rv[1] + v[1], rv[2] + v[2]], w: [omv[0] + w[0], omv[1] + w[1], omv[2] + w[2]], pts: new Float32Array(pts), rad: Math.hypot(R, h / 2) + 0.002, k2: 0.3 * R * R };
  };
  const lidB = fall ? disc(JAR.Rl, JAR.hl, JAR.H + JAR.hl / 2 - 0.004, [axis[0] * 1.6, axis[1] * 1.6 + 0.6, 0.5], [1.5, 2, -3])
    : disc(JAR.Rl, JAR.hl, JAR.H + JAR.hl / 2 - 0.004, [0.25, 2.6, 0.9], [5, 1.5, -3]);
  const plinthB = fall ? disc(JAR.Rp, JAR.hp, -JAR.hp / 2, [-0.3, 0.2, -0.25], [0.5, -1, 1])
    : disc(JAR.Rp, JAR.hp, -JAR.hp / 2, [0, 0, 0], [0, 0, 0]);
  const iLid = bodies.length; bodies.push(lidB);
  const iPlinth = bodies.length; bodies.push(plinthB);
  if (!fall) { plinthB.asleepForever = true; }
  const simOpt = { floorY, T: fall ? 5.0 : 3.2 };
  let rec;
  if (fall) rec = simulate(bodies, simOpt);
  else { // the plinth stays on its pedestal
    const keep = bodies[iPlinth]; const px = keep.x.slice(), pq = keep.q.slice();
    rec = simulate(bodies, simOpt);
    for (let f = 0; f < rec.nF; f++) { const o = (f * rec.nb + iPlinth) * 7; rec.frames.set([px[0], px[1], px[2], pq[0], pq[1], pq[2], pq[3]], o); }
  }
  const bodyOf = new Int32Array(n).fill(-1); bodyPieces.forEach((q, i) => { bodyOf[q] = i; });

  // dust: pieces too small for a body fly on a parabola and stay where they land
  const dust = [];
  for (let q = 0; q < n; q++) if (!isBody[q]) {
    const L = launchOf(q), r = 0.002;
    const vy = L.v[1], tl = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, L.x[1] - floorY - r))) / G;
    const wl = Math.hypot(L.w[0], L.w[1], L.w[2]) || 1;
    dust.push({ q, x: L.x, v: L.v, ax: [L.w[0] / wl, L.w[1] / wl, L.w[2] / wl], wl, tl });
  }

  // fluid: droplets that start as the cylinder of fluid and fly on parabolas, then smear along the floor
  const NF = 6500;
  const fP = new Float32Array(NF * 3), fV = new Float32Array(NF * 3), fA = new Float32Array(NF * 4), fS = new Float32Array(NF * 3);
  // fingers: the speed depends on the direction, so droplets thrown the same way string out into ligaments
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const finger = a => 0.5 * Math.pow(0.5 + 0.5 * Math.sin(a * 5 + ph[0]), 2) + 0.9 * Math.pow(0.5 + 0.5 * Math.sin(a * 11 + ph[1]), 5) + 0.5 * Math.pow(0.5 + 0.5 * Math.sin(a * 23 + ph[2]), 8);
  const finger2 = a => 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(a * 7 + ph[3]), 2) + 0.5 * Math.pow(0.5 + 0.5 * Math.sin(a * 17 + ph[1]), 6);
  const Rf = JAR.R - JAR.wall, yMid = 0.5 * (JAR.y0 + JAR.fill), yHalf = 0.5 * (JAR.fill - JAR.y0);
  const foot = fall ? [com[0], com[2]] : [0, 0];
  for (let i = 0; i < NF; i++) {
    const r = Rf * Math.sqrt(rng()), a = rng() * 6.2832, ly = JAR.y0 + rng() * (JAR.fill - JAR.y0);
    const loc = [r * Math.cos(a), ly, r * Math.sin(a)];
    let x = toW(loc), v, delay = 0;
    const radial = qrot(qJ, [Math.cos(a), 0, Math.sin(a)]), u = r / Rf;
    const big = rng();
    let size = 0.004 + 0.010 * rng() * rng() + (big > 0.96 ? 0.012 : 0), alpha = 1;
    if (big < 0.2) { size = 0.02 + 0.034 * rng(); alpha = 0.42; }   // soft sheets of fluid between the drops
    if (fall) {
      const crown = rng() < 0.32;
      if (crown) {
        // thrown up from where the fluid meets the floor
        const along = (ly - yMid) / yHalf, ang = rng() * 6.2832, rad = 0.02 + 0.06 * rng();
        x = [com[0] + axis[0] * along * yHalf * 0.9 + Math.cos(ang) * rad, floorY + 0.006, com[2] + Math.sin(ang) * rad * 1.3];
        const dx = x[0] - foot[0], dz = x[2] - foot[1], dl = Math.hypot(dx, dz) || 1;
        const da = Math.atan2(dz, dx), sc = 0.25 + 0.75 * Math.pow(rng(), 0.7);
        const sh = (0.5 + 1.5 * finger2(da)) * sc, up = (0.5 + 2.9 * finger(da)) * sc;
        v = [dx / dl * sh + 0.06 * gauss() + 0.2, up + 0.06 * gauss(), dz / dl * sh * 1.2 + 0.06 * gauss()];
        delay = 0.004 + 0.05 * rng();
        size *= 0.85;
      } else {
        const rv = rigidV(x), k = u * (0.3 + 1.3 * finger2(a) * rng()), ka = (ly - yMid) / yHalf * (0.4 + 1.3 * rng());
        v = [rv[0] * 0.95 + radial[0] * k + axis[0] * ka + 0.2 * gauss(), rv[1] * (0.75 + 0.25 * rng()) + radial[1] * k + axis[1] * ka + 0.2 * gauss(), rv[2] + radial[2] * k * 1.3 + 0.2 * gauss()];
      }
    } else {
      const k = (u + 0.25) * (0.4 + 1.7 * finger2(a) * (0.3 + 0.7 * rng()));
      v = [radial[0] * k + 0.25 * gauss(), -0.3 + 1.6 * rng() * rng() + 0.5 * (ly - yMid) / yHalf, radial[2] * k + 0.3 + 1.5 * rng() + 0.25 * gauss()];
      delay = 0.02 * rng() * (1 - u);
    }
    const vy = v[1], tl = (vy + Math.sqrt(vy * vy + 2 * G * Math.max(0, x[1] - floorY - 0.004))) / G;
    const vyl = vy - G * tl, lx = x[0] + v[0] * tl, lz = x[2] + v[2] * tl;
    const dx = lx - foot[0], dz = lz - foot[1], dl = Math.hypot(dx, dz) || 1, kick = Math.abs(vyl) * (0.12 + 0.45 * rng());
    fP.set(x, i * 3); fV.set(v, i * 3);
    fA.set([tl, delay, size, rng()], i * 4);
    fS.set([v[0] * 0.6 + dx / dl * kick, v[2] * 0.6 + dz / dl * kick, alpha], i * 3);
  }

  return {
    kind, res, n, T0, S, qJ, B, com, vCom, axis, originW, floorY, traj, comS, tRel, vStart,
    mesh, lines, bodyPieces, bodyOf, isBody, iLid, iPlinth, rec, dust,
    fluid: { n: NF, P: fP, V: fV, A: fA, S: fS },
    tEnd: simOpt.T,
  };
}

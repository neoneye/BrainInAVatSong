// core.js: the dust-on-glass simulation, ported from assets/dust/index.html (DustCore) and trimmed for the video:
// one kind of dust (old laboratory dust), no breath fog, no settling, no creep. A pane of NX × NY cells of CELL mm;
// each cell holds loose dust D and dried crust K (g/m²) and a wet-trail value; water drops sit on top as particles.
// Pure logic, no DOM, no Math.random: every random choice comes from the seeded generator in the state.

export const CELL = 0.8, NX = 960, NY = 540, N = NX * NY, W = NX * CELL, H = NY * CELL;   // 768 × 432 mm, 16:9
// the dust: grey-brown, fluffy, a little sticky (a finger leaves a thin smeared film), cakes when it gets wet
export const DUST = { kext: 0.36, stick: 0.38, cake: 0.6, grain: 0.45, coat: 6.6 };
// drawing tools: r (mm), eff (share lifted per pass), edge (soft rim), stickRes (how much stickiness resists), cakeFrac
// (how well it rubs off crust), side (share pushed to the ridges), ridge (mm outside the rim), leak (smudge per mm),
// streak / stripeW (stripes along the stroke), keep (share the hand carries away)
export const TOOLS = {
  finger: { r: 7, eff: 0.995, edge: 0.35, stickRes: 0.45, cakeFrac: 0.5, side: 0.55, ridge: 2.1, leak: 0.001, cap: 12, streak: 0.14, stripeW: 0.9, keep: 0.25 },
  palm: { r: 28, eff: 0.93, edge: 0.55, stickRes: 0.5, cakeFrac: 0.4, side: 0.12, ridge: 3, leak: 0.004, cap: 9, absorb: 0.012, streak: 0.55, stripeW: 2.2, keep: 0.4 },
};
export function mulberry(a) { return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const hash1 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export const vn1 = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i) + (hash1(i + 1) - hash1(i)) * u; };
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const cellAt = (x, y) => { const i = Math.floor(x / CELL), j = Math.floor(y / CELL); return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i; };
const SK = DUST.stick;      // effective stickiness (dry room)
const TILT = 90, SA = Math.sin(TILT * Math.PI / 180);
const DROP_SPEED = 3;       // drops run faster than in life, so a run crosses the frame within a shot

export function create() {
  return { D: new Float32Array(N), K: new Float32Array(N), WET: new Float32Array(N), WH: new Float32Array(N), GN: new Float32Array(N),
    drops: [], wtouched: [], lost: 0, rng: mulberry(1), anyWet: false, dirty: true };
}
function addMass(s, c, m, caked) { if (!(m > 0) || c < 0) return; if (caked) s.K[c] += m; else s.D[c] += m; }
// disc helper: calls fn(c, d) for cells within R of (x, y)
function disc(x, y, R, fn) {
  const i0 = Math.max(0, Math.floor((x - R) / CELL)), i1 = Math.min(NX - 1, Math.ceil((x + R) / CELL)), j0 = Math.max(0, Math.floor((y - R) / CELL)), j1 = Math.min(NY - 1, Math.ceil((y + R) / CELL));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y); if (d < R) fn(j * NX + i, d); }
}

// The long-abandoned pane for a seed: an uneven dry coat (soft blotches plus grain-to-grain noise), thicker toward the
// edges, with the dried rings and spots of old condensation drips in it. Returns { D, K } to copy into a state.
const PANES = new Map();
export function pane(seed) {
  let P = PANES.get(seed); if (P) return P;
  const s = create(), rng = mulberry(seed * 7919 + 11), GN = s.GN;
  const lat = (sc, amp) => { const gx = Math.ceil(NX / sc) + 2, gy = Math.ceil(NY / sc) + 2, g = new Float32Array(gx * gy).map(() => rng());
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const fx = i / sc, fy = j / sc, x0 = Math.floor(fx), y0 = Math.floor(fy), u = fx - x0, v = fy - y0, a = g[y0 * gx + x0], b = g[y0 * gx + x0 + 1], c = g[(y0 + 1) * gx + x0], d = g[(y0 + 1) * gx + x0 + 1];
      GN[j * NX + i] += amp * ((a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v - 0.5); } };
  GN.fill(1); lat(150, 0.4); lat(48, 0.28); lat(12, 0.2); lat(3, 0.18);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const c = j * NX + i, ex = Math.abs(i / NX - 0.5) * 2, ey = Math.abs(j / NY - 0.5) * 2, edge = Math.max(ex, ey);
    s.D[c] = DUST.coat * Math.max(0.2, GN[c] + 0.5 * (rng() - 0.5)) * (1 + 0.5 * smooth(0.6, 1, edge));
  }
  s.rng = rng;
  for (let k = 0; k < 320; k++) dryDrop(s, land(s, rng() * W, rng() * H, 0.6 + 2.2 * rng() ** 2, 8));
  s.drops.length = 0;
  PANES.set(seed, P = { D: s.D, K: s.K }); if (PANES.size > 6) PANES.delete(PANES.keys().next().value);
  return P;
}
export function reset(s, seed) {
  const P = pane(seed); s.D.set(P.D); s.K.set(P.K); s.WET.fill(0); s.WH.fill(0); s.drops = []; s.wtouched = []; s.lost = 0;
  s.rng = mulberry(seed * 104729 + 5); s.anyWet = false; s.dirty = true;
}

// ---------------------------------------------------------------- strokes
const FP_C = new Int32Array(1 << 18), FP_W = new Float32Array(1 << 18);
export function begin(s, tool, x, y, seed = 0) { return { tool, T: TOOLS[tool], x, y, ux: 1, uy: 0, load: 0, len: 0, n: 0, seed: seed || hash1(x * 7 + y) * 100 }; }
// drag the tool from its last point to (x, y), with radius r and pressure press (0..1)
export function move(s, st, x, y, r = st.T.r, press = 1) {
  const T = st.T, x0 = st.x, y0 = st.y, dx = x - x0, dy = y - y0, L = Math.hypot(dx, dy);
  if (st.n > 0 && L < 0.12) return;
  if (L > 1e-6) { st.ux = dx / L; st.uy = dy / L; }
  const ux = st.ux, uy = st.uy, nx = -uy, ny = ux; r *= 0.75 + 0.35 * press;
  const i0 = Math.max(0, Math.floor((Math.min(x0, x) - r) / CELL)), i1 = Math.min(NX - 1, Math.ceil((Math.max(x0, x) + r) / CELL));
  const j0 = Math.max(0, Math.floor((Math.min(y0, y) - r) / CELL)), j1 = Math.min(NY - 1, Math.ceil((Math.max(y0, y) + r) / CELL));
  const { D, K } = s; let nf = 0, wsum = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const rx = (i + 0.5) * CELL - x0, ry = (j + 0.5) * CELL - y0, a = rx * ux + ry * uy, q = rx * nx + ry * ny;
    const d = a < 0 ? Math.hypot(a, q) : a > L ? Math.hypot(a - L, q) : Math.abs(q);
    if (d >= r) continue;
    const c = j * NX + i, w = smooth(r, r * (1 - T.edge), Math.abs(q));   // the profile across the stroke
    const str = T.streak ? Math.max(0, 1 + T.streak * (vn1(q / T.stripeW + st.seed) * 2 - 1)) : 1;
    // share of the cell swept in this segment: a cell is inside the footprint over a chord of 2·sqrt(r² − q²)
    const chord = Math.max(0.6, 2 * Math.sqrt(Math.max(0, r * r - q * q))), share = st.n === 0 && L < 1e-6 ? 1 : Math.min(1, L / chord);
    const e = Math.min(1, (0.5 + 0.5 * press) * w * T.eff * (1 - T.stickRes * SK * SK) * str);
    const eS = 1 - Math.pow(1 - e, share), eK = 1 - Math.pow(1 - Math.min(1, e * T.cakeFrac), share);
    const mL = D[c] * eS, mK = K[c] * eK, m = mL + mK;
    FP_C[nf] = c; FP_W[nf] = w * str; wsum += w * str; nf++;
    if (m <= 0) continue;
    D[c] -= mL; K[c] -= mK;
    let toLoad = m;
    if (a >= 0 && a <= L && T.side > 0) {  // pushed aside into ridges along both edges
      const side = m * T.side, off = r + T.ridge * (0.5 + hash1(c * 0.37)), sg = q < 0 ? -1 : 1;
      const tc = cellAt(x0 + ux * a + nx * sg * off, y0 + uy * a + ny * sg * off);
      if (tc < 0) s.lost += side; else D[tc] += side;
      toLoad -= side;
    }
    st.load += toLoad;
  }
  // the finger carries a small heap ahead of it and what does not fit spills sideways
  if (st.load > 0 && T.absorb > 0) { const a = st.load * Math.min(1, T.absorb * L); s.lost += a; st.load -= a; }   // most of it sticks to the hand
  const capM = T.cap * Math.PI * r * r / (CELL * CELL) / 2;
  if (st.load > capM) {
    const ex = st.load - capM, off = r + T.ridge; st.load = capM;
    for (const sg of [-1, 1]) { const cs = []; disc(x + nx * sg * off - ux * r * 0.3, y + ny * sg * off - uy * r * 0.3, Math.max(1.2, T.ridge), c => { cs.push(c); }); if (!cs.length) s.lost += ex / 2; for (const c of cs) D[c] += ex / 2 / cs.length; }
  }
  // the dusty finger smears part of what it carries back behind it
  if (st.load > 0 && T.leak > 0 && wsum > 0) {
    const leak = st.load * Math.min(0.5, T.leak * (1 + 4 * SK) * Math.max(L, 0.3)), k = leak / wsum;
    for (let f = 0; f < nf; f++) D[FP_C[f]] += FP_W[f] * k;
    st.load -= leak;
  }
  st.x = x; st.y = y; st.len += L; st.n++; s.dirty = true;
}
// lift the tool: what it still carries is dropped in a crescent ahead of it (a ring for a dab), part stays on the hand
export function end(s, st, r = st.T.r) {
  if (!(st.load > 0)) return;
  const kept = st.load * st.T.keep; s.lost += kept; const m = st.load - kept; st.load = 0;
  const dab = st.len < 1, cx = dab ? st.x : st.x + st.ux * r * 0.75, cy = dab ? st.y : st.y + st.uy * r * 0.75, R = dab ? r * 1.4 : r * 0.65;
  const i0 = Math.max(0, Math.floor((cx - R) / CELL)), i1 = Math.min(NX - 1, Math.ceil((cx + R) / CELL)), j0 = Math.max(0, Math.floor((cy - R) / CELL)), j1 = Math.min(NY - 1, Math.ceil((cy + R) / CELL));
  let nf = 0, ws = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot((i + 0.5) * CELL - cx, (j + 0.5) * CELL - cy); let w;
    if (dab) w = d > r * 0.95 && d < R ? Math.sin(Math.PI * (d - r * 0.95) / (R - r * 0.95)) : 0;
    else { const a = ((i + 0.5) * CELL - st.x) * st.ux + ((j + 0.5) * CELL - st.y) * st.uy; w = d < R && a > r * 0.2 ? 1 - (d / R) ** 2 : 0; }
    if (w > 0) { w *= 0.6 + 0.8 * hash1(j * NX + i); FP_C[nf] = j * NX + i; FP_W[nf] = w; ws += w; nf++; }
  }
  if (!nf) { s.lost += m; return; }
  for (let f = 0; f < nf; f++) s.D[FP_C[f]] += m * FP_W[f] / ws;
  s.dirty = true;
}

// ---------------------------------------------------------------- drops
const rOf = V => Math.cbrt(V / 0.7);       // a sessile drop with a contact angle near 60°: V ≈ 0.7 r³ (mm³)
const RC = 1.8 / Math.sqrt(SA);            // above this radius a drop runs
// a drop lands: it wets and lifts most of the loose dust under it, and may carry dust of its own
export function land(s, x, y, r, mud = 0) {
  const d = { x, y, V: 0.7 * r * r * r, load: 0, rp: r, mv: false, vx: 0 };
  disc(x, y, r, c => { const m = s.D[c] * 0.82 + s.K[c] * 0.04; if (m > 0) { d.load += m; s.D[c] *= 0.18; s.K[c] *= 0.96; } });
  if (mud > 0) d.load += mud * Math.PI * r * r / (CELL * CELL);
  for (const o of s.drops) if (!o.dead && !o.mv && Math.hypot(o.x - x, o.y - y) < (rOf(o.V) + r) * 0.85) { merge(o, d); o.rp = Math.max(o.rp, rOf(o.V)); return o; }
  s.drops.push(d); s.dirty = true; return d;
}
function merge(into, d) { const V = into.V + d.V; into.x = (into.x * into.V + d.x * d.V) / V; into.y = (into.y * into.V + d.y * d.V) / V; into.V = V; into.load += d.load; d.dead = true; }
// a drop dries: its contact line stays pinned, so most of the dust ends in a ring at its edge (the coffee-ring effect)
export function dryDrop(s, d) {
  d.dead = true; if (!(d.load > 0)) return;
  const R = d.rp, ringF = 0.45 + 0.4 * (1 - DUST.grain); let wr = 0, wi = 0; const cs = [];
  disc(d.x, d.y, R * 1.08, (c, dist) => { const u = dist / R, ring = Math.exp(-(((u - 0.9) / 0.09) ** 2)), inner = u < 0.88 ? 0.6 + 0.8 * s.GN[c] / 1.5 : 0; cs.push(c, ring, inner); wr += ring; wi += inner; });
  if (!cs.length) { s.lost += d.load; return; }
  for (let k = 0; k < cs.length; k += 3) {
    const m = (wr > 0 ? d.load * ringF * cs[k + 1] / wr : 0) + (wi > 0 ? d.load * (wr > 0 ? 1 - ringF : 1) * cs[k + 2] / wi : 0);
    addMass(s, cs[k], m * DUST.cake, true); addMass(s, cs[k], m * (1 - DUST.cake), false);
  }
  s.dirty = true;
}
function updateDrops(s, dtReal, dtSim) {
  if (!s.drops.length) return;
  const B = 6, nb = Math.ceil(W / B), bucket = new Map();
  for (const d of s.drops) if (!d.mv && !d.dead) { const k = Math.floor(d.y / B) * nb + Math.floor(d.x / B); let a = bucket.get(k); if (!a) bucket.set(k, a = []); a.push(d); }
  const near = (d, r) => { const bx = Math.floor(d.x / B), by = Math.floor(d.y / B), n = Math.ceil((r + 3) / B);
    for (let j = by - n; j <= by + n; j++) for (let i = bx - n; i <= bx + n; i++) { const a = bucket.get(j * nb + i); if (!a) continue; for (const o of a) if (o !== d && !o.dead && Math.hypot(o.x - d.x, o.y - d.y) < (r + rOf(o.V)) * 0.8) merge(d, o); } };
  for (const d of s.drops) {
    if (d.dead) continue;
    let r = rOf(d.V);
    if (!d.mv && r > RC) d.mv = true;
    if (d.mv) {
      // a running drop: faster the further above the pinning size it is; it scours a channel, leaves a wet trail and
      // residue, shoves dust to its edges, swallows the drops it meets and stops when it has shrunk enough
      const v = Math.min(140, Math.max(4, 55 * (r / RC - 0.85) * SA)) * DROP_SPEED; let left = v * dtReal;
      while (left > 0 && !d.dead) {
        const step = Math.min(0.5, left); left -= step;
        const cw = cellAt(d.x - r * 1.2, d.y + r * 1.3), ce = cellAt(d.x + r * 1.2, d.y + r * 1.3), bias = cw >= 0 && ce >= 0 ? (s.WET[ce] - s.WET[cw]) * 0.08 : 0;   // drawn to wet tracks ahead
        d.vx = (d.vx + (s.rng() - 0.5) * 0.11 * Math.sqrt(step) + bias * step) * Math.pow(0.985, step); d.vx = Math.max(-0.6, Math.min(0.6, d.vx));   // a slow meander
        d.x = Math.min(W - 0.5, Math.max(0.5, d.x + d.vx * step)); d.y += step;
        const f = 1 - Math.pow(0.25, step / (1.5 * r));
        disc(d.x, d.y, r * 0.95, c => { const m = s.D[c] * f + s.K[c] * f * 0.2; if (m > 0) { d.load += m; s.D[c] -= s.D[c] * f; s.K[c] -= s.K[c] * f * 0.2; } s.WET[c] = 1; });
        s.anyWet = true;
        if (d.load > 0) { const m = d.load * 0.004 * step; d.load -= m; for (const sg of [-1, 1]) { const c = cellAt(d.x + sg * r * (1 + 0.25 * s.rng()), d.y - r * 0.3); if (c < 0) s.lost += m / 2; else { addMass(s, c, m / 2 * DUST.cake, true); addMass(s, c, m / 2 * (1 - DUST.cake), false); } } }
        d.V = Math.max(0, d.V - 0.03 * r * step);
        near(d, r); r = rOf(d.V);
        if (d.y + r >= H - 0.4) { d.dead = true; s.lost += d.load; break; }   // runs off the bottom of the frame
        if (r < 0.85 * RC) { d.mv = false; d.rp = r; break; }
      }
      s.dirty = true;
    } else {
      d.V -= 0.004 * r * 0.6 * dtSim;  // evaporation along the rim
      if (d.V <= 0.03) dryDrop(s, d);
    }
  }
  s.drops = s.drops.filter(d => !d.dead);
}
// raster the drops into water height for drawing
function rasterWater(s) {
  for (const c of s.wtouched) s.WH[c] = 0;
  s.wtouched.length = 0;
  for (const d of s.drops) {
    const r = rOf(d.V), hmax = 0.55 * r, tail = d.mv ? r * 1.6 : 0, R = r;
    const i0 = Math.max(0, Math.floor((d.x - R) / CELL)), i1 = Math.min(NX - 1, Math.ceil((d.x + R) / CELL)), j0 = Math.max(0, Math.floor((d.y - R - tail) / CELL)), j1 = Math.min(NY - 1, Math.ceil((d.y + R) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) * CELL - d.x, py = (j + 0.5) * CELL - d.y, t = tail ? Math.min(1, Math.max(0, -py / tail)) : 0, rad = R * (1 - 0.45 * t), dist = Math.hypot(px, py + t * tail);
      if (dist >= rad) continue;
      const c = j * NX + i, h = hmax * (1 - 0.5 * t) * (1 - (dist / rad) ** 2);
      if (s.WH[c] === 0) s.wtouched.push(c);
      if (h > s.WH[c]) s.WH[c] = h;
    }
  }
}
// advance the water: drops run at their real pace (dtReal); wet trails and resting drops dry on the slow clock dtSim
export function step(s, dtReal, dtSim) {
  if (!s.drops.length && !s.anyWet) return;
  const hadWater = s.wtouched.length > 0;
  updateDrops(s, dtReal, dtSim);
  if (s.anyWet) {
    const wetK = Math.exp(-dtSim / 60), WET = s.WET; let any = false;
    for (let c = 0; c < N; c++) if (WET[c] > 0) { WET[c] = WET[c] > 0.01 ? WET[c] * wetK : 0; any = true; }
    s.anyWet = any; s.dirty = true;
  }
  rasterWater(s);
  if (hadWater || s.wtouched.length) s.dirty = true;
}

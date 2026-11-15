// glasscore.js: the DOM-free fracture core of assets/glass-shatter/index.html (GlassCore), copied for the
// shatter scene: glass shape, impact, crack growth with branching, cutting the shell into pieces, piece meshes.
// Changes from the original: a "specimen" jar shape, an optional crack origin (P.origin) and no tests/UI helpers.
// Units are SI (metres, seconds, joules, pascals) unless a name says otherwise.
const GlassCore = (function () {
  "use strict";
  const TAU = Math.PI * 2;
  const G = 9.81;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  function rngFrom(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }

  // ---------------------------------------------------------------- materials
  // Rounded handbook values. KIc is the fracture toughness; the fracture energy
  // per unit crack area is Gc = KIc² (1 − ν²) / E.
  const GLASSES = {
    soda: { name: "Ordinary glass (annealed soda-lime)", E: 72e9, nu: 0.22, rho: 2500, KIc: 0.75e6, tempered: false,
      note: "Most tumblers, jars and cheap drinking glasses. Cooled slowly at the factory, so it holds almost no stress of its own." },
    tempered: { name: "Toughened glass (tempered soda-lime)", E: 72e9, nu: 0.22, rho: 2500, KIc: 0.75e6, tempered: true,
      note: "Cooled fast with air jets, so the skin is squeezed and the middle is stretched. That makes it far harder to break, but when a crack reaches the stretched core, all that stored energy is released at once and it bursts into small, blunt pieces." },
    boro: { name: "Borosilicate glass", E: 63e9, nu: 0.20, rho: 2230, KIc: 0.77e6, tempered: false,
      note: "Lab glass and some ovenware. Handles heat far better, but it is not much stronger against a drop." },
    crystal: { name: "Lead crystal", E: 60e9, nu: 0.22, rho: 3100, KIc: 0.68e6, tempered: false,
      note: "Heavy and soft. Lower stiffness means slower cracks, and the extra weight means more energy in the fall." },
    quenched: { name: "Quenched drop (dripped into cold water)", E: 72e9, nu: 0.22, rho: 2500, KIc: 0.75e6, tempered: true, skin: 4.5,
      note: "A blob of molten glass dripped into cold water. The skin freezes at once; the core cools later, shrinks, and pulls the skin into a squeeze of several hundred megapascals, while the core is left stretched. Far more stress than any toughened tumbler." },
  };
  function glassProps(P) {
    const g = GLASSES[P.glass] || GLASSES.soda;
    const Gc = g.KIc * g.KIc * (1 - g.nu * g.nu) / g.E;
    const cs = Math.sqrt(g.E / (2 * (1 + g.nu) * g.rho));
    const cR = cs * (0.862 + 1.14 * g.nu) / (1 + g.nu);
    const cPlate = Math.sqrt(g.E / (g.rho * (1 - g.nu * g.nu)));
    return { ...g, Gc, cs, cR, cPlate, vCrack: P.crackSpeed * cR };
  }

  // floor: share = how much of the fall energy ends up as strain in the glass.
  // A stiff floor stops the glass in tens of microseconds, so the glass must soak up
  // the energy itself; a soft floor gives way and takes most of it.
  const FLOORS = {
    tile:     { name: "Ceramic tiles", share: 0.60, rest: 0.35, fric: 0.35, E: 50e9 },
    stone:    { name: "Stone (granite)", share: 0.65, rest: 0.40, fric: 0.40, E: 60e9 },
    concrete: { name: "Concrete", share: 0.55, rest: 0.30, fric: 0.60, E: 30e9 },
    wood:     { name: "Wooden floorboards", share: 0.35, rest: 0.30, fric: 0.45, E: 12e9 },
    vinyl:    { name: "Vinyl on concrete", share: 0.25, rest: 0.25, fric: 0.50, E: 3e9 },
    carpet:   { name: "Carpet", share: 0.03, rest: 0.05, fric: 0.90, E: 0.03e9 },
  };

  // ---------------------------------------------------------------- shapes
  // Each shape gives the outer radius of the wall as a function of height, and default
  // sizes. Everything is a body of revolution: base disc, rounded heel, wall, rim.
  const SHAPES = {
    tumbler: { name: "Tumbler", H: 95, D: 80, wall: 2.8, base: 6, heel: 6,
      wallR: (y, d) => d.R * (0.86 + 0.14 * y / d.H) },
    highball: { name: "Tall glass", H: 150, D: 68, wall: 2.2, base: 6, heel: 6,
      wallR: (y, d) => d.R * (0.88 + 0.12 * y / d.H) },
    whiskey: { name: "Whisky glass (heavy base)", H: 88, D: 82, wall: 3, base: 13, heel: 3,
      wallR: (y, d) => d.R },
    stemless: { name: "Stemless wine glass", H: 112, D: 66, wall: 2.0, base: 5, heel: 8,
      wallR: (y, d) => {
        const Rb = d.R * 0.88, Rm = d.R * 1.36, yb = d.H * 0.38;
        if (y < yb) return Rb + (Rm - Rb) * Math.sin(0.5 * Math.PI * y / yb);
        const u = (y - yb) / (d.H - yb);
        return Rm + (d.R - Rm) * (1 - Math.cos(0.5 * Math.PI * u));
      } },
    jar: { name: "Jam jar", H: 110, D: 56, wall: 3, base: 6, heel: 7,
      wallR: (y, d) => {
        const Rb = d.R * 1.36, y1 = d.H * 0.70, y2 = d.H * 0.86;
        if (y < y1) return Rb;
        if (y < y2) return d.R + (Rb - d.R) * 0.5 * (1 + Math.cos(Math.PI * (y - y1) / (y2 - y1)));
        return d.R;
      } },
    specimen: { name: "Specimen jar", H: 110, D: 72, wall: 2.2, base: 3.5, heel: 3,
      wallR: (y, d) => d.R },
    bowl: { name: "Glass bowl", H: 65, D: 150, wall: 4, base: 6, heel: 8,
      wallR: (y, d) => { const Rb = d.R * 0.55; return Rb + (d.R - Rb) * Math.sin(0.5 * Math.PI * y / d.H); } },
    // solid glass: a round head that tapers into a long thin tail
    rupert: { name: "Prince Rupert's drop", solid: true, H: 95, D: 80, wall: 2.8, base: 6, heel: 6,
      extras: { glass: "quenched", temper: 140, cell: 0.35, tilt: 90, action: "snip", floor: "tile" } },
  };
  const SOLID = P => !!(SHAPES[P.shape] && SHAPES[P.shape].solid);
  const HAMMER_KG = 0.5;

  // ---------------------------------------------------------------- parameters
  const PARAMS = [
    // glass
    { id: "shape", group: "glass", label: "Shape", type: "select", def: "tumbler", options: () => Object.keys(SHAPES).map(k => [k, SHAPES[k].name]) },
    { id: "glass", group: "glass", label: "Glass", type: "select", def: "soda", options: () => Object.keys(GLASSES).map(k => [k, GLASSES[k].name]) },
    { id: "height", group: "glass", label: "Height", min: 50, max: 200, step: 1, def: 95, unit: "mm", only: P => !SOLID(P) },
    { id: "diam", group: "glass", label: "Rim diameter", min: 40, max: 180, step: 1, def: 80, unit: "mm", only: P => !SOLID(P) },
    { id: "wall", group: "glass", label: "Wall thickness", min: 1.2, max: 6, step: 0.1, def: 2.8, unit: "mm", only: P => !SOLID(P) },
    { id: "base", group: "glass", label: "Base thickness", min: 2, max: 20, step: 0.5, def: 6, unit: "mm", only: P => !SOLID(P) },
    { id: "head", group: "glass", label: "Head diameter", min: 4, max: 20, step: 0.5, def: 10, unit: "mm", only: SOLID },
    { id: "tail", group: "glass", label: "Tail length", min: 15, max: 120, step: 1, def: 55, unit: "mm", only: SOLID },
    { id: "temper", group: "glass", label: "Temper (tension in the core)", min: 10, max: 160, step: 1, def: 45, unit: "MPa", only: P => GLASSES[P.glass].tempered },
    { id: "flaw", group: "glass", label: "Deepest scratch", min: 2, max: 200, step: 1, def: 20, unit: "µm" },
    { id: "scatter", group: "glass", label: "Glasses differ (strength scatter)", type: "check", def: 1 },
    // drop
    { id: "action", group: "drop", label: "What happens to it", type: "select", def: "drop", only: SOLID,
      options: () => [["snip", "Snip the tail with pliers"], ["hammer", "Hit the head with a hammer"], ["drop", "Drop it on the floor"]] },
    { id: "hammerV", group: "drop", label: "Hammer speed (half-kilo hammer)", min: 0.5, max: 20, step: 0.1, def: 3, unit: "m/s", only: P => SOLID(P) && P.action === "hammer" },
    { id: "drop", group: "drop", label: "Drop height", min: 0.05, max: 3, step: 0.01, def: 0.9, unit: "m", only: P => !SOLID(P) || P.action === "drop" },
    { id: "tilt", group: "drop", label: "Tilt when it lands", min: 0, max: 180, step: 1, def: 20, unit: "°", only: P => !SOLID(P) || P.action === "drop" },
    { id: "floor", group: "drop", label: "Floor", type: "select", def: "tile", options: () => Object.keys(FLOORS).map(k => [k, FLOORS[k].name]) },
    { id: "seed", group: "drop", label: "Which glass (seed)", min: 1, max: 9999, step: 1, def: 7, unit: "" },
    // fracture model
    { id: "reach", group: "model", label: "Impact energy spreads over", min: 8, max: 60, step: 1, def: 25, unit: "mm" },
    { id: "ring", group: "model", label: "Energy that rings through the whole glass", min: 0, max: 40, step: 0.5, def: 2.5, unit: "%" },
    { id: "eta", group: "model", label: "Energy that goes into new crack faces", min: 0.03, max: 0.5, step: 0.01, def: 0.15, unit: "" },
    { id: "branchG", group: "model", label: "Fork when the crack is fed more than", min: 1.5, max: 10, step: 0.1, def: 3, unit: "× Gc" },
    { id: "branchAngle", group: "model", label: "Fork angle", min: 10, max: 90, step: 1, def: 32, unit: "°" },
    { id: "wander", group: "model", label: "Crack wander", min: 0, max: 15, step: 0.5, def: 3, unit: "°/√mm" },
    { id: "seek", group: "model", label: "Cracks turn toward unbroken glass", min: 0, max: 3, step: 0.05, def: 1, unit: "" },
    { id: "radial", group: "model", label: "Pull away from the impact", min: 0, max: 3, step: 0.05, def: 1, unit: "" },
    { id: "first", group: "model", label: "Stored energy that drives the first cracks", min: 0.2, max: 10, step: 0.1, def: 2, unit: "%" },
    { id: "coast", group: "model", label: "A crack coasts on its own momentum for", min: 1, max: 40, step: 0.5, def: 8, unit: "mm" },
    { id: "nucleate", group: "model", label: "New cracks start where pieces would be under", min: 0, max: 40, step: 1, def: 12, unit: "mm" },
    { id: "flawDensity", group: "model", label: "Flaws that can start a crack", min: 0, max: 8, step: 0.1, def: 1, unit: "/cm²" },
    { id: "crackSpeed", group: "model", label: "Crack speed (share of Rayleigh speed)", min: 0.2, max: 0.7, step: 0.01, def: 0.47, unit: "" },
    { id: "feed", group: "model", label: "A crack tip is fed from within", min: 1, max: 15, step: 0.5, def: 12, unit: "mm" },
    { id: "kick", group: "model", label: "Stored energy that throws the pieces", min: 0, max: 0.5, step: 0.01, def: 0.08, unit: "" },
    { id: "cell", group: "model", label: "Grid cell (finest piece)", min: 0.25, max: 1.6, step: 0.05, def: 0.75, unit: "mm" },
  ];
  const PBYID = Object.fromEntries(PARAMS.map(p => [p.id, p]));
  function defaults() { const o = {}; for (const p of PARAMS) o[p.id] = p.def; return o; }
  function decimals(step) { const s = String(step); const k = s.indexOf("."); return k < 0 ? 0 : s.length - k - 1; }
  function clampParam(id, v) {
    const p = PBYID[id];
    if (!p) return v;
    if (p.type === "select") { const ok = p.options().some(o => o[0] === v); return ok ? v : p.def; }
    if (p.type === "check") return v ? 1 : 0;
    let x = Number(v);
    if (!isFinite(x)) x = p.def;
    x = clamp(x, p.min, p.max);
    x = Math.round((x - p.min) / p.step) * p.step + p.min;
    return Number(x.toFixed(decimals(p.step)));
  }
  function shapeDefaults(shape) {
    const s = SHAPES[shape] || SHAPES.tumbler;
    return { height: s.H, diam: s.D, wall: s.wall, base: s.base, ...(s.extras || {}) };
  }
  // when leaving a shape with extras, these keys go back to the plain defaults
  function shapeExtrasKeys() { const k = new Set(); for (const s of Object.values(SHAPES)) for (const id in (s.extras || {})) k.add(id); return [...k]; }
  function encodeHash(P) {
    const d = defaults(), parts = [];
    const sd = shapeDefaults(P.shape);
    for (const p of PARAMS) {
      const base = sd[p.id] !== undefined ? sd[p.id] : d[p.id];
      if (P[p.id] !== base) parts.push(p.id + "=" + encodeURIComponent(P[p.id]));
    }
    return parts.join("&");
  }
  function decodeHash(str) {
    const P = defaults();
    const kv = {};
    for (const part of String(str || "").replace(/^#/, "").split("&")) {
      if (!part) continue;
      const k = part.indexOf("=");
      if (k < 0) continue;
      kv[part.slice(0, k)] = decodeURIComponent(part.slice(k + 1));
    }
    if (kv.shape !== undefined) P.shape = clampParam("shape", kv.shape);
    Object.assign(P, shapeDefaults(P.shape));
    for (const id in kv) if (PBYID[id] && id !== "shape") P[id] = clampParam(id, PBYID[id].type === "select" ? kv[id] : Number(kv[id]));
    return P;
  }

  // Situations (scenarios).
  const SCENARIOS = [
    { id: "halves", name: "Two halves: a short drop onto wood", note: "Only just enough to break it. One crack starts at the heel and runs both ways, up the wall and across the base, and the glass falls apart in two.",
      set: { shape: "tumbler", glass: "soda", drop: 0.55, floor: "wood", tilt: 25, seed: 12 } },
    { id: "mixed", name: "Mixed: off the kitchen counter onto tiles", note: "The usual kitchen accident. Small splinters where it hit, longer shards up the wall, and a few big pieces far from the impact.",
      set: { shape: "tumbler", glass: "soda", drop: 0.9, floor: "tile", tilt: 20, seed: 7 } },
    { id: "tiny", name: "Tiny pieces: a toughened tumbler on tiles", note: "Many cheap tumblers are toughened glass. It survives drops that break ordinary glass, but when it does break, the energy locked in by tempering bursts it into hundreds of small, blunt pieces.",
      set: { shape: "tumbler", glass: "tempered", drop: 1.3, floor: "tile", tilt: 20, seed: 3, flaw: 60 } },
    { id: "carpet", name: "Survives: the same drop onto carpet", note: "Carpet gives way over a few milliseconds instead of a few tens of microseconds, so the glass never feels a large force.",
      set: { shape: "tumbler", glass: "soda", drop: 0.9, floor: "carpet", tilt: 20, seed: 7 } },
    { id: "flat", name: "Lands flat on its base", note: "The impact spreads over the whole base, so the stress is much lower than when it lands on the edge of the base. A flat landing often survives the same fall.",
      set: { shape: "tumbler", glass: "soda", drop: 0.9, floor: "tile", tilt: 0, seed: 7 } },
    { id: "whisky", name: "Heavy whisky glass: the base survives", note: "A crack has to pay for every square millimetre of new surface, so cracks rarely get through a 13 mm base. The wall shatters around a solid base.",
      set: { shape: "whiskey", glass: "soda", drop: 1.0, floor: "stone", tilt: 30, seed: 4 } },
    { id: "side", name: "Knocked over: lands on its side", note: "A glass that rolls off a table lands along its side. The cracks start along the line of contact.",
      set: { shape: "highball", glass: "soda", drop: 0.75, floor: "tile", tilt: 90, seed: 9 } },
    { id: "rim", name: "Upside down: lands on the rim", note: "The rim is the thinnest part, and a rim landing chips and splinters it.",
      set: { shape: "tumbler", glass: "soda", drop: 0.8, floor: "tile", tilt: 150, seed: 5 } },
    { id: "scratched", name: "Old scratched glass from a low drop", note: "Years in the dishwasher leave scratches a tenth of a millimetre deep. Strength falls with the square root of the scratch depth, so an old glass breaks from a height a new one survives.",
      set: { shape: "tumbler", glass: "soda", drop: 0.3, floor: "tile", tilt: 20, seed: 21, flaw: 150 } },
    { id: "high", name: "From a shelf onto concrete", note: "Two metres onto concrete. The impact zone turns to powder and splinters fly far.",
      set: { shape: "tumbler", glass: "soda", drop: 2.0, floor: "concrete", tilt: 35, seed: 2 } },
    { id: "jar", name: "Jam jar onto stone", note: "Thick walls need more energy per centimetre of crack, so a jar tends to break into fewer, chunkier pieces.",
      set: { shape: "jar", glass: "soda", drop: 1.2, floor: "stone", tilt: 30, seed: 8 } },
    { id: "wine", name: "Stemless wine glass, thin wall", note: "Thin glass needs little energy per centimetre of crack, so the same fall makes many more pieces.",
      set: { shape: "stemless", glass: "soda", drop: 0.9, floor: "tile", tilt: 20, seed: 6 } },
    { id: "crystal", name: "Lead crystal tumbler onto tiles", note: "Heavier, so more energy in the fall, and slower cracks.",
      set: { shape: "tumbler", glass: "crystal", drop: 0.9, floor: "tile", tilt: 20, seed: 7 } },
    { id: "rupert", name: "Prince Rupert's drop: snip the tail", note: "The famous one. Snip the thin tail and the crack reaches the stretched core; the whole drop bursts into powder from the tail to the head, faster than a rifle bullet.",
      set: { shape: "rupert", action: "snip", seed: 4 } },
    { id: "rupertHammer", name: "Prince Rupert's drop: hammer on the head", note: "The head shrugs off a hammer blow that would shatter a glass marble, because its skin is squeezed by several hundred megapascals. Turn the hammer speed up far enough and it finally gives, and the whole drop bursts from the head.",
      set: { shape: "rupert", action: "hammer", hammerV: 3, seed: 4 } },
    { id: "rupertDrop", name: "Prince Rupert's drop dropped on tiles", note: "It just bounces.",
      set: { shape: "rupert", action: "drop", drop: 1.5, tilt: 90, seed: 4 } },
    { id: "bowl", name: "Glass bowl slips out of a hand", note: "A wide, shallow bowl landing on its rim edge.",
      set: { shape: "bowl", glass: "tempered", drop: 1.0, floor: "tile", tilt: 60, seed: 11, flaw: 80 } },
  ];
  function applyScenario(id) {
    const s = SCENARIOS.find(x => x.id === id);
    const P = defaults();
    if (!s) return P;
    if (s.set.shape) Object.assign(P, shapeDefaults(s.set.shape));
    for (const k in s.set) P[k] = clampParam(k, s.set[k]);
    return P;
  }

  // ---------------------------------------------------------------- profile
  // Outer and inner profile curves (r, y) with matched stations, resampled to uniform
  // arc length v along the OUTER curve. v = 0 is the centre of the base underside;
  // v = L is the rim.
  function buildProfile(P) {
    const S = SHAPES[P.shape] || SHAPES.tumbler;
    if (S.solid) return buildDropProfile(P);
    const d = { H: P.height / 1000, R: P.diam / 2000 };
    const tw = P.wall / 1000, tb = P.base / 1000;
    const rho = Math.max(S.heel / 1000, 0.0015);
    const wallR = y => S.wallR(y, d);
    const slope = y => (wallR(Math.min(d.H, y + 1e-4)) - wallR(Math.max(0, y - 1e-4))) / (Math.min(d.H, y + 1e-4) - Math.max(0, y - 1e-4));
    const innerR = y => { const s = slope(y); return wallR(y) - tw * Math.sqrt(1 + s * s); };

    // outer heel: tangent to the base (y = 0) and to the wall near y = rho. The heel
    // lifts the base a little on flaring walls; stretch the wall so the rim stays at H.
    { const sa = slope(rho), na = Math.hypot(1, sa); d.H += rho * sa / na; }
    const s0 = slope(rho), nn = Math.hypot(1, s0);
    const n0 = [1 / nn, -s0 / nn];
    const Ws = [wallR(rho), rho];
    const C = [Ws[0] - rho * n0[0], Ws[1] - rho * n0[1]];
    const yBase = C[1] - rho;
    const aEnd = Math.atan2(n0[1], n0[0]);
    // inner heel
    const ybi = yBase + tb;
    const rhoi = Math.min(Math.max(0.0012, rho * 0.4), 0.004);
    const Ciy = ybi + rhoi;
    const si = slope(Math.min(d.H, Ciy)), ni = Math.hypot(1, si);
    const nI = [1 / ni, -si / ni];
    const Cix = innerR(Math.min(d.H, Ciy)) - rhoi * nI[0];
    const aEndI = Math.atan2(nI[1], nI[0]);
    const Ei = [Cix + rhoi * Math.cos(aEndI), Ciy + rhoi * Math.sin(aEndI)];

    const O = [], I = [];
    const seg = (n, fo, fi) => { for (let k = 0; k < n; k++) { const u = k / n; O.push(fo(u)); I.push(fi(u)); } };
    const nb = 60, nh = 40, nw = 300;
    seg(nb, u => [u * C[0], yBase], u => [u * Math.max(1e-4, Cix), ybi]);
    seg(nh, u => { const a = -Math.PI / 2 + u * (aEnd + Math.PI / 2); return [C[0] + rho * Math.cos(a), C[1] + rho * Math.sin(a)]; },
            u => { const a = -Math.PI / 2 + u * (aEndI + Math.PI / 2); return [Cix + rhoi * Math.cos(a), Ciy + rhoi * Math.sin(a)]; });
    const yi0 = Math.min(Ei[1], d.H - 0.002);
    seg(nw, u => { const y = rho + u * (d.H - rho); return [wallR(y), y]; },
            u => { const y = yi0 + u * (d.H - yi0); return [innerR(y), y]; });
    O.push([wallR(d.H), d.H]); I.push([innerR(d.H), d.H]);
    for (const p of O) p[1] -= yBase;
    for (const p of I) p[1] -= yBase;
    return finishProfile(O, I, nb);
  }
  // A Prince Rupert's drop: a ball of a head on the axis at the bottom (v = 0 at the
  // pole) tapering into a long tail that ends in a thin tip (the "rim"). It is solid,
  // so the inner curve is the axis: each surface point is joined to the axis along its
  // normal (the centre of the ball for the head).
  function buildDropProfile(P) {
    const R = P.head / 2000, Lt = P.tail / 1000, rt = Math.min(0.00025, R * 0.05);
    const yTip = 2 * R + Lt;
    const tailR = y => rt + (R - rt) * Math.pow(1 / (1 + ((y - R) / (0.9 * R)) ** 2), 0.8);
    const O = [];
    const nh = 120, nt = 700;
    for (let k = 0; k < nh; k++) { const a = 0.5 * Math.PI * k / nh; O.push([R * Math.sin(a), R - R * Math.cos(a)]); }
    for (let k = 0; k <= nt; k++) { const u = k / nt, y = R + (yTip - R) * u * u * (3 - 2 * u) * 0.5 + (yTip - R) * u * 0.5; O.push([tailR(y), y]); }
    const I = O.map((p, k) => {
      const a = O[Math.max(0, k - 1)], b = O[Math.min(O.length - 1, k + 1)];
      const tr = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tr, ty) || 1;
      const nr = ty / tl, ny = -tr / tl;
      const dd = nr > 1e-3 ? p[0] / nr : R;
      return [0, p[1] - ny * dd];
    });
    I[0] = [0, R];
    const prof = finishProfile(O, I, nh);
    prof.solid = true; prof.headR = R;
    return prof;
  }
  function finishProfile(O, I, nb) {
    // arc length along the outer curve
    const vRaw = [0];
    for (let k = 1; k < O.length; k++) vRaw.push(vRaw[k - 1] + Math.hypot(O[k][0] - O[k - 1][0], O[k][1] - O[k - 1][1]));
    const L = vRaw[vRaw.length - 1];
    const N = Math.ceil(L / 0.0002) + 1;
    const dv = L / (N - 1);
    const r = new Float64Array(N), y = new Float64Array(N), ri = new Float64Array(N), yi = new Float64Array(N);
    let k = 0;
    for (let s = 0; s < N; s++) {
      const v = s * dv;
      while (k < vRaw.length - 2 && vRaw[k + 1] < v) k++;
      const f = clamp((v - vRaw[k]) / Math.max(1e-12, vRaw[k + 1] - vRaw[k]), 0, 1);
      r[s] = O[k][0] + f * (O[k + 1][0] - O[k][0]);
      y[s] = O[k][1] + f * (O[k + 1][1] - O[k][1]);
      ri[s] = I[k][0] + f * (I[k + 1][0] - I[k][0]);
      yi[s] = I[k][1] + f * (I[k + 1][1] - I[k][1]);
    }
    r[0] = 0; ri[0] = 0;
    const nr = new Float64Array(N), ny = new Float64Array(N), nri = new Float64Array(N), nyi = new Float64Array(N), th = new Float64Array(N);
    for (let s = 0; s < N; s++) {
      const a = Math.max(0, s - 1), b = Math.min(N - 1, s + 1);
      let tr = r[b] - r[a], ty = y[b] - y[a], tl = Math.hypot(tr, ty) || 1;
      nr[s] = ty / tl; ny[s] = -tr / tl;
      tr = ri[b] - ri[a]; ty = yi[b] - yi[a]; tl = Math.hypot(tr, ty) || 1;
      nri[s] = -ty / tl; nyi[s] = tr / tl;
      th[s] = Math.hypot(r[s] - ri[s], y[s] - yi[s]);
    }
    let rmax = 0;
    for (let s = 0; s < N; s++) rmax = Math.max(rmax, r[s]);
    return { N, dv, L, r, y, ri, yi, nr, ny, nri, nyi, th, rmax, H: y[N - 1], vHeel: vRaw[nb] };
  }
  // linear interpolation of a profile array at arc length v
  function pAt(prof, arr, v) {
    const x = clamp(v / prof.dv, 0, prof.N - 1);
    const k = Math.min(prof.N - 2, Math.floor(x)), f = x - k;
    return arr[k] + f * (arr[k + 1] - arr[k]);
  }
  // nearest arc length on the outer curve to (rr, yy), searching near a guess
  function projectV(prof, rr, yy, vGuess) {
    let s0 = Math.round(clamp(vGuess / prof.dv, 0, prof.N - 1));
    let best = s0, bd = Infinity;
    const span = 40;
    for (let s = Math.max(0, s0 - span); s <= Math.min(prof.N - 1, s0 + span); s++) {
      const dd = (prof.r[s] - rr) ** 2 + (prof.y[s] - yy) ** 2;
      if (dd < bd) { bd = dd; best = s; }
    }
    // refine on the neighbouring segments
    let vb = best * prof.dv;
    for (const s of [best - 1, best]) {
      if (s < 0 || s >= prof.N - 1) continue;
      const ax = prof.r[s], ay = prof.y[s], bx = prof.r[s + 1], by = prof.y[s + 1];
      const ex = bx - ax, ey = by - ay, ll = ex * ex + ey * ey;
      if (ll <= 0) continue;
      const f = clamp(((rr - ax) * ex + (yy - ay) * ey) / ll, 0, 1);
      const dd = (ax + f * ex - rr) ** 2 + (ay + f * ey - yy) ** 2;
      if (dd <= bd + 1e-18) { bd = dd; vb = (s + f) * prof.dv; }
    }
    return vb;
  }
  function outerPoint(prof, phi, v) {
    const r = pAt(prof, prof.r, v), y = pAt(prof, prof.y, v);
    return [r * Math.cos(phi), y, r * Math.sin(phi)];
  }
  function innerPoint(prof, phi, v) {
    const r = pAt(prof, prof.ri, v), y = pAt(prof, prof.yi, v);
    return [r * Math.cos(phi), y, r * Math.sin(phi)];
  }
  function outerNormal(prof, phi, v) {
    const nr = pAt(prof, prof.nr, v), ny = pAt(prof, prof.ny, v);
    const l = Math.hypot(nr, ny) || 1;
    return [nr / l * Math.cos(phi), ny / l, nr / l * Math.sin(phi)];
  }
  function innerNormal(prof, phi, v) {
    const nr = pAt(prof, prof.nri, v), ny = pAt(prof, prof.nyi, v);
    const l = Math.hypot(nr, ny) || 1;
    return [nr / l * Math.cos(phi), ny / l, nr / l * Math.sin(phi)];
  }

  // ---------------------------------------------------------------- chart grid
  // Cells in (phi, v). Cell (i, j) covers phi in [i, i+1)·dphi and v in [j, j+1)·dv.
  function buildChart(prof, cellMM) {
    const h = cellMM / 1000;
    let nphi = Math.max(24, Math.round(TAU * prof.rmax / h));
    if (nphi % 2) nphi++;
    const nv = Math.max(8, Math.round(prof.L / h));
    const dphi = TAU / nphi, dv = prof.L / nv;
    const rowR = new Float64Array(nv), rowT = new Float64Array(nv), rowA = new Float64Array(nv), rowMid = new Float64Array(nv * 2), rowF = new Float64Array(nv);
    let area = 0, mass = 0;
    for (let j = 0; j < nv; j++) {
      const v = (j + 0.5) * dv;
      rowR[j] = pAt(prof, prof.r, v);
      rowT[j] = pAt(prof, prof.th, v);
      rowA[j] = rowR[j] * dphi * dv;
      rowF[j] = clamp(1 - rowT[j] * pAt(prof, prof.nr, v) / (2 * Math.max(1e-9, rowR[j])), 0.3, 1);
      rowMid[2 * j] = 0.5 * (pAt(prof, prof.r, v) + pAt(prof, prof.ri, v));
      rowMid[2 * j + 1] = 0.5 * (pAt(prof, prof.y, v) + pAt(prof, prof.yi, v));
      area += rowA[j] * nphi;
    }
    return { nphi, nv, dphi, dv, h, n: nphi * nv, rowR, rowT, rowA, rowMid, rowF, area };
  }

  // ---------------------------------------------------------------- geodesics
  function dijkstra(chart, seeds) {
    const { nphi, nv, dphi, dv, rowR, n } = chart;
    const dist = new Float64Array(n).fill(Infinity);
    // binary heap of (d, idx)
    const hd = [], hi = [];
    const push = (d, i) => {
      hd.push(d); hi.push(i);
      let c = hd.length - 1;
      while (c > 0) { const p = (c - 1) >> 1; if (hd[p] <= hd[c]) break; [hd[p], hd[c]] = [hd[c], hd[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; }
    };
    const pop = () => {
      const d = hd[0], i = hi[0];
      const ld = hd.pop(), li = hi.pop();
      if (hd.length) {
        hd[0] = ld; hi[0] = li;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < hd.length && hd[l] < hd[m]) m = l;
          if (r < hd.length && hd[r] < hd[m]) m = r;
          if (m === c) break;
          [hd[m], hd[c]] = [hd[c], hd[m]]; [hi[m], hi[c]] = [hi[c], hi[m]]; c = m;
        }
      }
      return [d, i];
    };
    for (const s of seeds) { dist[s] = 0; push(0, s); }
    while (hd.length) {
      const [d, idx] = pop();
      if (d > dist[idx]) continue;
      const i = idx % nphi, j = (idx - i) / nphi;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= nv) continue;
        const rr = 0.5 * (rowR[j] + rowR[jj]);
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ii = (i + di + nphi) % nphi;
          const w = Math.hypot(di * rr * dphi, dj * dv);
          const k = ii + jj * nphi;
          if (d + w < dist[k]) { dist[k] = d + w; push(d + w, k); }
        }
      }
      if (j === 0) { // across the centre of the base
        const k = ((i + nphi / 2) % nphi);
        const w = 2 * rowR[0];
        if (d + w < dist[k]) { dist[k] = d + w; push(d + w, k); }
      }
    }
    return dist;
  }

  // ---------------------------------------------------------------- the impact
  // The glass falls without turning, tilted by P.tilt about the world z axis so that
  // the phi = 0 side goes down. Returns the pose, the contact cells and the energetics.
  function cupRotation(tiltDeg) {
    const a = -tiltDeg * Math.PI / 180; // rotation about z
    return { c: Math.cos(a), s: Math.sin(a), q: [0, 0, Math.sin(a / 2), Math.cos(a / 2)] };
  }
  function rotZ(R, p) { return [R.c * p[0] - R.s * p[1], R.s * p[0] + R.c * p[1], p[2]]; }

  function impact(P, prof, chart, rng) {
    const gp = glassProps(P);
    const fl = FLOORS[P.floor] || FLOORS.tile;
    const R = cupRotation(P.tilt);
    const { nphi, nv, dphi, dv, rowR, rowT, rowA, rowMid } = chart;
    // world height of each cell centre (outer surface), and of the inner surface for rim landings
    let minY = Infinity;
    const hgt = new Float64Array(chart.n);
    for (let j = 0; j < nv; j++) {
      const v = (j + 0.5) * dv;
      const ro = pAt(prof, prof.r, v), yo = pAt(prof, prof.y, v);
      const rI = pAt(prof, prof.ri, v), yI = pAt(prof, prof.yi, v);
      for (let i = 0; i < nphi; i++) {
        const phi = (i + 0.5) * dphi, c = Math.cos(phi);
        let w = R.s * ro * c + R.c * yo;
        if (j === nv - 1) w = Math.min(w, R.s * rI * c + R.c * yI);
        hgt[i + j * nphi] = w;
        if (w < minY) minY = w;
      }
    }
    // the lowest point of the whole body, including the rim edge, for placing it on the floor
    const tol = 0.0004 + 0.6 * chart.h;
    const action = prof.solid ? P.action : "drop";
    const seeds = [];
    let Aseed = 0, tSeed = 0;
    let pick = k => hgt[k] <= minY + tol;
    if (action === "snip") {
      // the pliers bite the last 1.5 mm of the tail
      const jMin = nv - Math.max(1, Math.ceil(0.0015 / dv));
      pick = k => ((k / nphi) | 0) >= jMin;
    } else if (action === "hammer") {
      // the hammer lands on the top of the head
      const jHead = Math.min(nv - 1, Math.ceil(1.6 * prof.headR / dv));
      let maxY = -Infinity;
      for (let k = 0; k < jHead * nphi; k++) maxY = Math.max(maxY, hgt[k]);
      pick = k => k < jHead * nphi && hgt[k] >= maxY - tol;
    }
    if (P.origin) {
      const o = P.origin, r0 = o.r || 0.003;
      pick = k => {
        const i = k % nphi, j = (k - i) / nphi, v = (j + 0.5) * dv;
        let dp = (i + 0.5) * dphi - o.phi; dp -= TAU * Math.round(dp / TAU);
        return Math.hypot(rowR[j] * dp, pAt(prof, prof.y, v) - o.y) < r0 && pAt(prof, prof.nr, v) > 0.7;
      };
    }
    for (let k = 0; k < chart.n; k++) if (pick(k)) { seeds.push(k); const j = (k / nphi) | 0; Aseed += rowA[j]; tSeed += rowA[j] * rowT[j]; }
    tSeed /= Math.max(1e-12, Aseed);
    // mass and centre of mass (cup frame)
    let M = 0, cx = 0, cy = 0;
    for (let j = 0; j < nv; j++) { const m = gp.rho * rowA[j] * rowT[j] * chart.rowF[j] * nphi; M += m; cy += m * rowMid[2 * j + 1]; }
    cy /= M;
    const seedCentre = [0, 0, 0];
    for (const k of seeds) {
      const i = k % nphi, j = (k - i) / nphi, phi = (i + 0.5) * dphi;
      const p = outerPoint(prof, phi, (j + 0.5) * dv);
      seedCentre[0] += p[0]; seedCentre[1] += p[1]; seedCentre[2] += p[2];
    }
    for (let a = 0; a < 3; a++) seedCentre[a] /= seeds.length;

    const h = action === "drop" ? P.drop : 0;
    const vImp = Math.sqrt(2 * G * h);
    const a = P.flaw * 1e-6;
    const sigmaFlaw = gp.KIc / (1.12 * Math.sqrt(Math.PI * a));
    let weib = 1;
    if (P.scatter) { const q = clamp(rng(), 1e-6, 1 - 1e-6); weib = Math.pow(-Math.log(1 - q) / Math.LN2, 1 / 7); }
    const CT = gp.tempered ? P.temper * 1e6 : 0;
    const sigmaSurf = (gp.skin || 2) * CT;           // parabolic temper profile: skin −2·CT
    const sigmaF = sigmaFlaw * weib + sigmaSurf;
    const L = P.reach / 1000;
    let KE, Ug, Veff, sigmaPeak, breaks, Ucrit, Uex, hertz = null;
    if (!prof.solid) {
      KE = M * G * h;
      Ug = fl.share * KE;
      Veff = (Aseed + Math.PI * L * L) * tSeed;
      sigmaPeak = Math.sqrt(2 * gp.E * Ug / Veff);
      breaks = sigmaPeak > sigmaF;
      Ucrit = sigmaF * sigmaF * Veff / (2 * gp.E);
      Uex = breaks ? Math.max(0, Ug - Ucrit) : 0;
    } else if (action === "snip") {
      // pliers always break the thin tail: its squeezed skin is only a fraction of a millimetre deep
      KE = 0; Ug = 0.002; Veff = Aseed * tSeed; sigmaPeak = NaN; breaks = true; Ucrit = Ug; Uex = 0;
    } else {
      // a ball pressed on a flat (Hertz): the tension that cracks glass is the ring at the
      // edge of the contact, (1 − 2ν)/3 of the contact pressure; it fades within a fraction of
      // the contact radius, far shallower than the squeezed skin, so only a share counts
      const hammer = action === "hammer";
      const Ec = hammer ? 210e9 : fl.E, nuc = hammer ? 0.3 : 0.25;
      const Es = 1 / ((1 - gp.nu * gp.nu) / gp.E + (1 - nuc * nuc) / Ec);
      const meff = hammer ? HAMMER_KG : M, vv = hammer ? P.hammerV : vImp;
      const Rc = prof.headR;
      KE = 0.5 * meff * vv * vv;
      const delta = Math.pow(15 * meff * vv * vv / (16 * Es * Math.sqrt(Rc)), 0.4);
      const F = 4 / 3 * Es * Math.sqrt(Rc) * Math.pow(delta, 1.5);
      const ac = Math.sqrt(Rc * delta);
      const p0 = 3 * F / (2 * Math.PI * ac * ac);
      sigmaPeak = (1 - 2 * gp.nu) / 3 * p0 * 0.25;
      hertz = { F, a: ac, p0, delta, v: vv, m: meff };
      breaks = sigmaPeak > sigmaF;
      Veff = Aseed * tSeed;
      Ug = 0.001 * KE; Ucrit = Ug * Math.min(1, (sigmaF / sigmaPeak) ** 2); Uex = breaks ? Ug - Ucrit : 0;
    }
    const uRes = gp.tempered ? 0.8 * (1 - gp.nu) * CT * CT / gp.E : 0; // J/m³
    // fracture mirror: sigma·sqrt(r) ≈ 2 MPa·√m for soda-lime glass
    const mirror = Math.pow(2.0e6 / Math.max(1, sigmaFlaw * weib), 2);
    // contact time on the floor, from the floor's share: stiff floors stop it in tens of µs
    const tFall = action === "drop" ? Math.sqrt(2 * h / G) : action === "snip" ? 0.35 : 0.3;
    return { R, minY, seeds, seedCentre, Aseed, tSeed, M, cy, vImp, KE, Ug, Veff, sigmaPeak, sigmaFlaw: sigmaFlaw * weib, sigmaSurf, sigmaF, breaks, Ucrit, Uex, uRes, mirror, gp, floor: fl, weib, tFall,
      action, solid: !!prof.solid, held: action !== "drop", hertz };
  }

  // energy density per unit area of shell (J/m²) available to drive cracks, per cell
  function energyField(P, chart, imp, dist) {
    const n = chart.n, { nphi, rowA, rowT } = chart;
    const L = P.reach / 1000;
    let sum = 0;
    for (let k = 0; k < n; k++) sum += rowA[(k / nphi) | 0] * Math.exp(-dist[k] / L);
    const ring = P.ring / 100;
    const eLoc = new Float64Array(n), eAll = new Float64Array(n);
    const eG = imp.breaks ? ring * imp.Ug / chart.area : 0;
    for (let k = 0; k < n; k++) {
      const j = (k / nphi) | 0;
      eLoc[k] = (1 - ring) * imp.Uex * Math.exp(-dist[k] / L) / sum;
      eAll[k] = imp.breaks ? eLoc[k] + eG + imp.uRes * rowT[j] * chart.rowF[j] : 0;
    }
    return { eLoc, eAll, eG };
  }

  // ---------------------------------------------------------------- crack growth
  // Crack tips walk over the shell at the terminal crack speed. Each tip draws the
  // stored energy from a disc around it (the disc shrinks where the energy is dense),
  // pays Gc·t per metre of new crack, forks when it is fed much more than it needs,
  // stops when it runs out, at the rim, or when it runs into another crack.
  function growCracks(P, prof, chart, imp, field, dist, rng) {
    const gp = imp.gp;
    const { nphi, nv, dphi, dv, rowR, rowT, rowA, n } = chart;
    const out = { cracks: [], hCut: new Float32Array(n), hPos: new Float32Array(n), wCut: new Float32Array(n), wPos: new Float32Array(n),
      events: { branch: 0, arrest: 0, join: 0, rim: 0, nucleate: 0, origin: 0 }, tEnd: 0, steps: 0, tips: [] };
    if (!imp.breaks) return out;
    const E = Float64Array.from(field.eAll);   // energy left per cell (J/m²)
    const owner = new Int32Array(n).fill(-1);  // crack id that passed through the cell
    const ox = new Float32Array(n), oy = new Float32Array(n);
    const ds = 0.4 * chart.h;
    const v = gp.vCrack, dt = ds / v;
    const eta = P.eta, Gc = gp.Gc;
    const Rmax = P.feed / 1000, Rmin = chart.h * 0.75;
    const graceSteps = Math.ceil(2.2 * chart.h / ds) + 2;
    const wander = P.wander * Math.PI / 180 * Math.sqrt(ds * 1000);
    const halfFork = 0.5 * P.branchAngle * Math.PI / 180;
    const minForkGap = Math.max(1.2e-3, 2.5 * chart.h);
    const centre = imp.seedCentre;

    const cellOf = (X, Y) => {
      const j = Math.floor(Y); if (j < 0 || j >= nv) return -1;
      const i = ((Math.floor(X) % nphi) + nphi) % nphi;
      return i + j * nphi;
    };
    // chart coords of a 3D point on the outer surface
    const toChart = (p, vGuess) => {
      const rr = Math.hypot(p[0], p[2]);
      let phi = Math.atan2(p[2], p[0]); if (phi < 0) phi += TAU;
      const vv = projectV(prof, rr, p[1], vGuess);
      return [phi / dphi, vv / dv, vv, phi];
    };
    const cut = (X0, Y0, X1, Y1, t) => {
      // horizontal link lines Y = j + 0.5 and vertical link lines X = i + 0.5
      const ya = Math.min(Y0, Y1), yb = Math.max(Y0, Y1);
      for (let c = Math.ceil(ya - 0.5) + 0.5; c <= yb; c += 1) {
        if (c < ya || Y1 === Y0) continue;
        const f = (c - Y0) / (Y1 - Y0); if (f < 0 || f > 1) continue;
        const X = X0 + f * (X1 - X0), j = c - 0.5;
        if (j < 0 || j >= nv) continue;
        const i = ((Math.floor(X - 0.5) % nphi) + nphi) % nphi;
        const k = i + j * nphi;
        if (!out.hCut[k]) { out.hCut[k] = t + 1e-9; out.hPos[k] = X - Math.floor(X - 0.5) + i; }
      }
      const xa = Math.min(X0, X1), xb = Math.max(X0, X1);
      for (let c = Math.ceil(xa - 0.5) + 0.5; c <= xb; c += 1) {
        if (c < xa || X1 === X0) continue;
        const f = (c - X0) / (X1 - X0); if (f < 0 || f > 1) continue;
        const Y = Y0 + f * (Y1 - Y0), jj = Math.floor(Y - 0.5);
        if (jj < 0 || jj >= nv - 1) continue;
        const i = ((Math.round(c - 0.5) % nphi) + nphi) % nphi;
        const k = i + jj * nphi;
        if (!out.wCut[k]) { out.wCut[k] = t + 1e-9; out.wPos[k] = Y; }
      }
    };

    const tips = [];
    let nextId = 0;
    const newCrack = (p, ch, dir, budget, t, parent, kind) => {
      const id = nextId++;
      const crack = { id, parent, kind, pts: [p[0], p[1], p[2]], ch: [ch[0], ch[1]], t: [t], end: null, born: t };
      out.cracks.push(crack);
      tips.push({ id, p: p.slice(), X: ch[0], Y: ch[1], vv: ch[2], d: dir.slice(), B: 0, res: budget, age: 0, gEma: 0, sinceFork: 0, alive: true });
      return crack;
    };
    const tangentFrame = (vv, phi) => {
      const nrm = outerNormal(prof, phi, vv);
      // e_v direction along the profile (towards the rim), e_phi around
      const a = Math.max(0, vv - 2e-4), b = Math.min(prof.L, vv + 2e-4);
      const pa = outerPoint(prof, phi, a), pb = outerPoint(prof, phi, b);
      let ev = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      let l = Math.hypot(ev[0], ev[1], ev[2]) || 1; ev = ev.map(x => x / l);
      const ephi = [-Math.sin(phi), 0, Math.cos(phi)];
      return { nrm, ev, ephi };
    };
    const projT = (d, nrm) => {
      const dn = d[0] * nrm[0] + d[1] * nrm[1] + d[2] * nrm[2];
      let x = [d[0] - dn * nrm[0], d[1] - dn * nrm[1], d[2] - dn * nrm[2]];
      const l = Math.hypot(x[0], x[1], x[2]);
      return l > 1e-12 ? x.map(c => c / l) : null;
    };
    const rotAbout = (d, nrm, ang) => {
      // rotate tangent d about the normal by ang
      const c = Math.cos(ang), s = Math.sin(ang);
      const x = [nrm[1] * d[2] - nrm[2] * d[1], nrm[2] * d[0] - nrm[0] * d[2], nrm[0] * d[1] - nrm[1] * d[0]];
      return [d[0] * c + x[0] * s, d[1] * c + x[1] * s, d[2] * c + x[2] * s];
    };
    const awayDir = (p, nrm) => projT([p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]], nrm);

    // --- origins: a single crack through the impact point when it only just breaks,
    // a star of cracks when there is energy to spare.
    const seedK = imp.seeds[Math.floor(rng() * imp.seeds.length)];
    {
      // pick the seed cell closest to the seed centroid
      let best = seedK, bd = Infinity;
      for (const k of imp.seeds) {
        const i = k % nphi, j = (k - i) / nphi;
        const p = outerPoint(prof, (i + 0.5) * dphi, (j + 0.5) * dv);
        const dd = (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2 + (p[2] - centre[2]) ** 2;
        if (dd < bd) { bd = dd; best = k; }
      }
      const i = best % nphi, j = (best - i) / nphi;
      const phi = (i + 0.5) * dphi, vv = (j + 0.5) * dv;
      const p = outerPoint(prof, phi, vv);
      const fr = tangentFrame(vv, phi);
      const ratio = imp.Uex / Math.max(1e-9, imp.Ucrit);
      const nOrig = clamp(2 + Math.floor(3 * Math.sqrt(ratio)), 2, 12) + (imp.uRes > 0 ? 1 : 0);
      const B0 = (P.first / 100) * imp.Ucrit / nOrig;
      // first direction: along the profile (cracks from a heel impact run up the wall)
      const base = rng() * 0.6 - 0.3;
      for (let q = 0; q < nOrig; q++) {
        let ang = base + q * TAU / nOrig + (nOrig > 2 ? (rng() - 0.5) * 0.5 : (rng() - 0.5) * 0.35);
        if (imp.action === "snip") ang = Math.PI + (q / Math.max(1, nOrig - 1) - 0.5) * 1.2 + (rng() - 0.5) * 0.2;
        const dir = [fr.ev[0] * Math.cos(ang) + fr.ephi[0] * Math.sin(ang), fr.ev[1] * Math.cos(ang) + fr.ephi[1] * Math.sin(ang), fr.ev[2] * Math.cos(ang) + fr.ephi[2] * Math.sin(ang)];
        newCrack(p, [i + 0.5, j + 0.5, vv], dir, B0, 0, -1, "origin");
        out.events.origin++;
      }
      out.origin = { phi, v: vv, p, X: i + 0.5, Y: j + 0.5 };
    }

    // --- flaw sites for secondary cracks, triggered by the stress wave
    const sites = [];
    if (P.nucleate > 0 && P.flawDensity > 0) {
      const count = Math.round(P.flawDensity * 1e4 * chart.area);
      const thr = 2 * Gc / (eta * (P.nucleate / 1000)); // e·t-scaled: d_nat < nucleate
      for (let q = 0; q < count; q++) {
        // area-uniform: pick a row by area, then a column
        const u = rng() * chart.area;
        let acc = 0, j = 0;
        for (; j < nv - 1; j++) { acc += rowA[j] * nphi; if (acc >= u) break; }
        const i = Math.floor(rng() * nphi);
        const k = i + j * nphi;
        const eDrive = field.eLoc[k] + field.eG;
        if (eDrive / rowT[j] < thr) continue;
        sites.push({ k, i, j, t: dist[k] / gp.cPlate, X: i + rng(), Y: j + rng(), used: false });
      }
      sites.sort((a, b) => a.t - b.t);
    }
    let siteIdx = 0;

    const MAX_TIPS = 6000, MAX_STEPS = 60000;
    let step = 0, t = 0;
    const dNat = (k, j) => 2 * Gc * rowT[j] / (eta * Math.max(1e-9, field.eAll[k]));
    let alive = tips.length;
    while ((alive > 0 || siteIdx < sites.length) && step < MAX_STEPS) {
      step++; t = step * dt;
      // secondary cracks from flaws when the wave has passed and nothing has relieved the stress yet
      while (siteIdx < sites.length && sites[siteIdx].t <= t) {
        const s = sites[siteIdx++];
        const k = s.k;
        if (owner[k] >= 0 || E[k] < 0.5 * field.eAll[k]) continue;
        // no crack within 1.5 mm
        let near = false;
        const rr = Math.max(1, Math.ceil(1.5e-3 / chart.h));
        for (let dj = -rr; dj <= rr && !near; dj++) for (let di = -rr; di <= rr; di++) { const kk = cellOf(s.X + di, s.Y + dj); if (kk >= 0 && owner[kk] >= 0) { near = true; break; } }
        if (near) continue;
        const phi = s.X * dphi, vv = s.Y * dv;
        const p = outerPoint(prof, phi, vv);
        const fr = tangentFrame(vv, phi);
        const aw = awayDir(p, fr.nrm) || fr.ev;
        let hoop = [fr.nrm[1] * aw[2] - fr.nrm[2] * aw[1], fr.nrm[2] * aw[0] - fr.nrm[0] * aw[2], fr.nrm[0] * aw[1] - fr.nrm[1] * aw[0]];
        hoop = rotAbout(hoop, fr.nrm, (rng() - 0.5) * 0.8);
        const B = 0.5 * Gc * rowT[s.j] * 0.004;
        newCrack(p, [s.X, s.Y, vv], hoop, B, t, -2, "flaw");
        newCrack(p, [s.X, s.Y, vv], hoop.map(c => -c), B, t, -2, "flaw");
        out.events.nucleate++;
      }
      alive = 0;
      const nTips = tips.length;
      for (let ti = 0; ti < nTips; ti++) {
        const tp = tips[ti];
        if (!tp.alive) continue;
        const crack = out.cracks[tp.id];
        const k0 = cellOf(tp.X, tp.Y);
        const j0 = k0 >= 0 ? (k0 / nphi) | 0 : 0;
        const tLoc = rowT[j0];
        // --- harvest energy from the disc ahead of and around the tip
        const Rh = clamp(0.5 * dNat(Math.max(0, k0), j0), Rmin, Rmax);
        let gain = 0, gx = 0, gy = 0;
        {
          const rr = Math.max(chart.h * 0.5, rowR[j0]);
          const dj = Math.ceil(Rh / dv), di = Math.min(nphi / 2, Math.ceil(Rh / (rr * dphi)));
          const Xc = tp.X, Yc = tp.Y;
          for (let jj = Math.max(0, Math.floor(Yc) - dj); jj <= Math.min(nv - 1, Math.floor(Yc) + dj); jj++) {
            const dy = (jj + 0.5 - Yc) * dv;
            const rj = 0.5 * (rowR[jj] + rr);
            for (let q = -di; q <= di; q++) {
              const ii = Math.floor(Xc) + q;
              const dx = (ii + 0.5 - Xc) * rj * dphi;
              if (dx * dx + dy * dy > Rh * Rh) continue;
              const kk = ((ii % nphi) + nphi) % nphi + jj * nphi;
              if (E[kk] > 0) { const w = E[kk] * rowA[jj]; gain += w; gx += w * dx; gy += w * dy; E[kk] = 0; }
            }
          }
        }
        const cost = Gc * tLoc * ds;
        // what it is fed now, capped (a crack has no savings beyond its momentum),
        // then the reserve the first cracks got from the energy stored at fracture
        tp.B = Math.min(tp.B + gain - cost, Gc * tLoc * P.coast / 1000);
        if (tp.B < 0 && tp.res > 0) { const take = Math.min(tp.res, -tp.B); tp.res -= take; tp.B += take; }
        tp.gEma += ((gain / ds) / tLoc - tp.gEma) * Math.min(1, ds / 1e-3);
        tp.age++; tp.sinceFork += ds;
        if (tp.B < 0 && tp.age > 2) { tp.alive = false; crack.end = "arrest"; out.events.arrest++; continue; }
        // --- steer: wander, and pull away from the impact where the impact drives the crack
        const phiNow = tp.X * dphi;
        const fr = tangentFrame(tp.vv, phiNow);
        let d = projT(tp.d, fr.nrm) || fr.ev;
        d = rotAbout(d, fr.nrm, gauss(rng) * wander);
        if (P.seek > 0 && gain > 0) {
          // toward the energy-weighted centre of the fresh glass it just drew from
          const sx = gx / gain, sy = gy / gain, sl = Math.hypot(sx, sy);
          if (sl > 1e-6) {
            const sd = [(fr.ephi[0] * sx + fr.ev[0] * sy) / sl, (fr.ephi[1] * sx + fr.ev[1] * sy) / sl, (fr.ephi[2] * sx + fr.ev[2] * sy) / sl];
            const w = P.seek * (sl / Rh) * ds / 4e-3;
            d = projT([d[0] + w * sd[0], d[1] + w * sd[1], d[2] + w * sd[2]], fr.nrm) || d;
          }
        }
        if (P.radial > 0 && k0 >= 0) {
          const share = (field.eLoc[k0] + field.eG) / Math.max(1e-9, field.eAll[k0]);
          const aw = awayDir(tp.p, fr.nrm);
          if (aw) {
            const w = P.radial * share * ds / 4e-3;
            d = projT([d[0] + w * aw[0], d[1] + w * aw[1], d[2] + w * aw[2]], fr.nrm) || d;
          }
        }
        // --- fork when it is fed far more than it needs
        if (tp.gEma > P.branchG * Gc && tp.sinceFork > Math.max(minForkGap, 2 * Math.min(dNat(Math.max(0, k0), j0), 4 * Rmax)) && tips.length < MAX_TIPS && tp.age > graceSteps) {
          // in tempered glass the stress is the same in every direction, so forks open wider
          const resShare = k0 >= 0 ? clamp(1 - (field.eLoc[k0] + field.eG) / Math.max(1e-9, field.eAll[k0]), 0, 1) : 0;
          const hf = halfFork + (Math.PI / 4 - halfFork) * resShare;
          const da = rotAbout(d, fr.nrm, hf * (0.8 + 0.4 * rng()));
          const db = rotAbout(d, fr.nrm, -hf * (0.8 + 0.4 * rng()));
          tp.alive = false; crack.end = "fork"; out.events.branch++;
          const ch = [tp.X, tp.Y, tp.vv];
          const ca = newCrack(tp.p, ch, da, tp.res / 2, t, tp.id, "branch"), cb = newCrack(tp.p, ch, db, tp.res / 2, t, tp.id, "branch");
          tips[tips.length - 1].B = tips[tips.length - 2].B = tp.B / 2;
          continue;
        }
        // --- move, in sub-steps, cutting links and watching for other cracks
        const pNew0 = [tp.p[0] + d[0] * ds, tp.p[1] + d[1] * ds, tp.p[2] + d[2] * ds];
        // project back onto the outer surface
        const cNew = toChart(pNew0, tp.vv);
        let vv = cNew[2], phi = cNew[3];
        let stop = null;
        if (vv >= prof.L - 1e-6) { vv = prof.L; stop = "rim"; }
        const pNew = outerPoint(prof, phi, vv);
        let X1 = phi / dphi, Y1 = vv / dv;
        // unwrap X relative to the tip
        while (X1 - tp.X > nphi / 2) X1 -= nphi;
        while (X1 - tp.X < -nphi / 2) X1 += nphi;
        if (stop === "rim") Y1 = nv + 0.01;
        // join check along the segment
        const nsub = Math.max(1, Math.ceil(Math.hypot((X1 - tp.X) * rowR[j0] * dphi, (Y1 - tp.Y) * dv) / (0.3 * chart.h)));
        let Xp = tp.X, Yp = tp.Y, joined = false;
        for (let q = 1; q <= nsub; q++) {
          const f = q / nsub;
          const Xq = tp.X + f * (X1 - tp.X), Yq = tp.Y + f * (Y1 - tp.Y);
          const kq = cellOf(Xq, Yq);
          if (kq >= 0 && owner[kq] >= 0 && owner[kq] !== tp.id && tp.age > graceSteps) {
            // fresh, energy-rich glass on the far side: the crack runs on across
            const ka = cellOf(Xq + (X1 - tp.X) / Math.max(1e-9, Math.hypot(X1 - tp.X, Y1 - tp.Y)) * 2.5, Yq + (Y1 - tp.Y) / Math.max(1e-9, Math.hypot(X1 - tp.X, Y1 - tp.Y)) * 2.5);
            if (ka >= 0 && owner[ka] < 0) {
              const ja = (ka / nphi) | 0;
              const Ra = clamp(0.5 * dNat(ka, ja), Rmin, Rmax);
              if (2 * Ra * E[ka] / rowT[ja] > P.branchG * Gc) { tp.age = 0; out.events.cross = (out.events.cross || 0) + 1; cut(Xp, Yp, Xq, Yq, t); Xp = Xq; Yp = Yq; continue; }
            }
            // run on to the other crack's point in that cell, slightly past it
            let Xo = ox[kq], Yo = oy[kq];
            while (Xo - Xp > nphi / 2) Xo -= nphi;
            while (Xo - Xp < -nphi / 2) Xo += nphi;
            const ex = Xo - Xp, ey = Yo - Yp, el = Math.hypot(ex, ey) || 1;
            const Xe = Xo + 0.08 * ex / el, Ye = Yo + 0.08 * ey / el;
            cut(Xp, Yp, Xe, Ye, t);
            Xp = Xe; Yp = Ye; joined = true; break;
          }
          cut(Xp, Yp, Xq, Yq, t);
          if (kq >= 0 && owner[kq] < 0) { owner[kq] = tp.id; ox[kq] = Xq; oy[kq] = Yq; }
          Xp = Xq; Yp = Yq;
        }
        let Xs = ((Xp % nphi) + nphi) % nphi;
        const vEnd = clamp(Yp, 0, nv) * dv;
        const pEnd = joined ? outerPoint(prof, Xs * dphi, vEnd) : pNew;
        crack.pts.push(pEnd[0], pEnd[1], pEnd[2]); crack.ch.push(Xs, Math.min(Yp, nv)); crack.t.push(t);
        tp.p = pEnd; tp.X = Xs; tp.Y = Math.min(Yp, nv - 1e-6); tp.vv = vEnd; tp.d = d;
        if (joined) { tp.alive = false; crack.end = "join"; out.events.join++; continue; }
        if (stop) { tp.alive = false; crack.end = stop; out.events.rim++; continue; }
      }
      alive = 0;
      for (let ti = 0; ti < tips.length; ti++) if (tips[ti].alive) alive++;
      // compact the tip list now and then
      if (tips.length > 2000 && step % 64 === 0) {
        let w = 0;
        for (let r = 0; r < tips.length; r++) if (tips[r].alive) tips[w++] = tips[r];
        tips.length = w;
      }
    }
    for (const c of out.cracks) if (!c.end) c.end = "cap";
    out.tEnd = t; out.steps = step; out.dt = dt;
    out.Eleft = E;
    return out;
  }

  // ---------------------------------------------------------------- pieces
  function labelPieces(chart, cr) {
    const { nphi, nv, n } = chart;
    const lab = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    let count = 0;
    for (let s = 0; s < n; s++) {
      if (lab[s] >= 0) continue;
      let sp = 0; stack[sp++] = s; lab[s] = count;
      while (sp) {
        const k = stack[--sp];
        const i = k % nphi, j = (k - i) / nphi;
        // right: h(i, j); left: h(i-1, j); up: w(i, j); down: w(i, j-1)
        const ir = (i + 1) % nphi, il = (i - 1 + nphi) % nphi;
        if (!cr.hCut[k]) { const kk = ir + j * nphi; if (lab[kk] < 0) { lab[kk] = count; stack[sp++] = kk; } }
        if (!cr.hCut[il + j * nphi]) { const kk = il + j * nphi; if (lab[kk] < 0) { lab[kk] = count; stack[sp++] = kk; } }
        if (j < nv - 1 && !cr.wCut[k]) { const kk = k + nphi; if (lab[kk] < 0) { lab[kk] = count; stack[sp++] = kk; } }
        if (j > 0 && !cr.wCut[k - nphi]) { const kk = k - nphi; if (lab[kk] < 0) { lab[kk] = count; stack[sp++] = kk; } }
      }
      count++;
    }
    return { lab, count };
  }

  // properties of every piece: cells, mass, centre of mass (cup frame), release time
  function pieceProps(prof, chart, cr, L, rho, field) {
    const { nphi, nv, dphi, dv, rowA, rowT, rowMid } = chart;
    const P = [];
    for (let q = 0; q < L.count; q++) P.push({ id: q, cells: 0, area: 0, mass: 0, com: [0, 0, 0], tRel: 0, e: 0, rows: [Infinity, -Infinity] });
    for (let k = 0; k < chart.n; k++) {
      const q = L.lab[k], i = k % nphi, j = (k - i) / nphi;
      const pc = P[q];
      const m = rho * rowA[j] * rowT[j] * chart.rowF[j];
      const phi = (i + 0.5) * dphi;
      const mr = rowMid[2 * j], my = rowMid[2 * j + 1];
      pc.cells++; pc.area += rowA[j]; pc.mass += m;
      pc.com[0] += m * mr * Math.cos(phi); pc.com[1] += m * my; pc.com[2] += m * mr * Math.sin(phi);
      pc.e += field.eAll[k] * rowA[j];
      if (j < pc.rows[0]) pc.rows[0] = j; if (j > pc.rows[1]) pc.rows[1] = j;
      // release time = latest cut on the boundary of the piece
      const ir = (i + 1) % nphi;
      const tr = cr.hCut[k];
      if (tr && L.lab[ir + j * nphi] !== q) { pc.tRel = Math.max(pc.tRel, tr); const o = P[L.lab[ir + j * nphi]]; o.tRel = Math.max(o.tRel, tr); }
      if (j < nv - 1) { const tu = cr.wCut[k]; if (tu && L.lab[k + nphi] !== q) { pc.tRel = Math.max(pc.tRel, tu); const o = P[L.lab[k + nphi]]; o.tRel = Math.max(o.tRel, tu); } }
    }
    for (const pc of P) { for (let a = 0; a < 3; a++) pc.com[a] /= pc.mass; pc.e /= pc.area; pc.size = Math.sqrt(pc.area); }
    return P;
  }

  // ---------------------------------------------------------------- meshes
  // One merged mesh. Per vertex: position relative to its piece's centre of mass (cup
  // frame), normal, piece index, face kind (0 outer, 1 inner, 2 fracture face, 3 rim),
  // and the distance along the glass from the impact (for drawing the stress wave).
  function buildMesh(prof, chart, cr, L, pieces, dist) {
    const { nphi, nv, dphi, dv } = chart;
    const lab = L.lab;
    // snapped lattice vertices: vertex (i, j) at chart X = i, Y = j
    const nvx = nphi * (nv + 1);
    const snapX = new Float32Array(nvx), snapY = new Float32Array(nvx);
    const boundaryH = (i, j) => { // link h(i, j) is a piece boundary
      if (j < 0 || j >= nv) return false;
      const ii = ((i % nphi) + nphi) % nphi, k = ii + j * nphi;
      return cr.hCut[k] > 0 && lab[k] !== lab[(ii + 1) % nphi + j * nphi];
    };
    const boundaryW = (i, j) => {
      if (j < 0 || j >= nv - 1) return false;
      const ii = ((i % nphi) + nphi) % nphi, k = ii + j * nphi;
      return cr.wCut[k] > 0 && lab[k] !== lab[k + nphi];
    };
    for (let j = 0; j <= nv; j++) for (let i = 0; i < nphi; i++) {
      let sx = 0, sy = 0, c = 0;
      const addH = (ii, jj) => { if (boundaryH(ii, jj)) { const k = ((ii % nphi) + nphi) % nphi + jj * nphi; let X = cr.hPos[k]; while (X - i > nphi / 2) X -= nphi; while (X - i < -nphi / 2) X += nphi; sx += X; sy += jj + 0.5; c++; } };
      const addW = (ii, jj) => { if (boundaryW(ii, jj)) { const k = ((ii % nphi) + nphi) % nphi + jj * nphi; sx += ii + 0.5; sy += cr.wPos[k]; c++; } };
      addH(i - 1, j - 1); addH(i - 1, j); addW(i - 1, j - 1); addW(i, j - 1);
      const vi = i + j * nphi;
      if (c) { snapX[vi] = clamp(sx / c, i - 0.95, i + 0.95); snapY[vi] = clamp(sy / c, Math.max(0, j - 0.95), Math.min(nv, j + 0.95)); }
      else { snapX[vi] = i; snapY[vi] = j; }
    }
    // centre of the base is one point
    for (let i = 0; i < nphi; i++) { snapY[i] = 0; }
    for (let i = 0; i < nphi; i++) { const vi = i + nv * nphi; snapY[vi] = nv; }

    // vertex positions on the lattice (outer and inner)
    const vOut = new Float32Array(nvx * 3), vIn = new Float32Array(nvx * 3), nOut = new Float32Array(nvx * 3), nIn = new Float32Array(nvx * 3), dAt = new Float32Array(nvx);
    for (let vi = 0; vi < nvx; vi++) {
      const phi = snapX[vi] * dphi, v = clamp(snapY[vi] * dv, 0, prof.L);
      const a = outerPoint(prof, phi, v), b = innerPoint(prof, phi, v), na = outerNormal(prof, phi, v), nb = innerNormal(prof, phi, v);
      vOut.set(a, vi * 3); vIn.set(b, vi * 3); nOut.set(na, vi * 3); nIn.set(nb, vi * 3);
      const i = vi % nphi, j = Math.min(nv - 1, (vi - i) / nphi);
      dAt[vi] = dist[i + j * nphi];
    }

    // collect cells per piece
    const order = new Int32Array(chart.n);
    const start = new Int32Array(L.count + 1);
    for (let k = 0; k < chart.n; k++) start[lab[k] + 1]++;
    for (let q = 0; q < L.count; q++) start[q + 1] += start[q];
    const fill = start.slice(0, L.count);
    for (let k = 0; k < chart.n; k++) order[fill[lab[k]]++] = k;

    const pos = [], nor = [], pid = [], kind = [], dimp = [], idx = [];
    let vcount = 0;
    const pieceRange = new Int32Array(L.count * 2);
    const map = new Map();
    for (let q = 0; q < L.count; q++) {
      map.clear();
      const com = pieces[q].com;
      const idx0 = idx.length;
      const vert = (vi, side) => { // side 0 outer, 1 inner (smooth)
        const key = vi * 2 + side;
        let id = map.get(key);
        if (id !== undefined) return id;
        const src = side ? vIn : vOut, ns = side ? nIn : nOut;
        pos.push(src[vi * 3] - com[0], src[vi * 3 + 1] - com[1], src[vi * 3 + 2] - com[2]);
        nor.push(ns[vi * 3], ns[vi * 3 + 1], ns[vi * 3 + 2]);
        pid.push(q); kind.push(side); dimp.push(dAt[vi]);
        id = vcount++; map.set(key, id); return id;
      };
      const flat = (vis, sides, k) => { // a fracture or rim face, flat shaded
        const ps = vis.map((vi, m) => { const src = sides[m] ? vIn : vOut; return [src[vi * 3], src[vi * 3 + 1], src[vi * 3 + 2]]; });
        const e1 = [ps[1][0] - ps[0][0], ps[1][1] - ps[0][1], ps[1][2] - ps[0][2]], e2 = [ps[2][0] - ps[0][0], ps[2][1] - ps[0][1], ps[2][2] - ps[0][2]];
        let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const l = Math.hypot(nn[0], nn[1], nn[2]) || 1; nn = nn.map(c => c / l);
        const ids = ps.map((p, m) => { pos.push(p[0] - com[0], p[1] - com[1], p[2] - com[2]); nor.push(nn[0], nn[1], nn[2]); pid.push(q); kind.push(k); dimp.push(dAt[vis[m]]); return vcount++; });
        idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      };
      for (let o = start[q]; o < start[q + 1]; o++) {
        const k = order[o], i = k % nphi, j = (k - i) / nphi, i1 = (i + 1) % nphi;
        const a = i + j * nphi, b = i1 + j * nphi, c = i1 + (j + 1) * nphi, d = i + (j + 1) * nphi;
        // outer: a, d, c, b faces outward (see the derivation in the spec)
        const oa = vert(a, 0), ob = vert(b, 0), oc = vert(c, 0), od = vert(d, 0);
        if (j === 0) idx.push(od, oc, ob); else idx.push(oa, od, oc, oa, oc, ob);
        const ia = vert(a, 1), ib = vert(b, 1), ic = vert(c, 1), id = vert(d, 1);
        if (j === 0) idx.push(id, ib, ic); else idx.push(ia, ib, ic, ia, ic, id);
        // side faces where the neighbour belongs to another piece
        const right = lab[i1 + j * nphi] !== q, left = lab[(i - 1 + nphi) % nphi + j * nphi] !== q;
        const up = j === nv - 1 ? true : lab[k + nphi] !== q, down = j > 0 && lab[k - nphi] !== q;
        if (right) flat([b, c, c, b], [0, 0, 1, 1], 2);
        if (left) flat([a, a, d, d], [0, 1, 1, 0], 2);
        if (up) flat([d, d, c, c], [0, 1, 1, 0], j === nv - 1 ? 3 : 2);
        if (down) flat([a, b, b, a], [0, 0, 1, 1], 2);
      }
      pieceRange[q * 2] = idx0; pieceRange[q * 2 + 1] = idx.length - idx0;
    }
    // fix winding so that every triangle faces along its normal
    const P3 = pos, N3 = nor;
    for (let t = 0; t < idx.length; t += 3) {
      const A = idx[t], B = idx[t + 1], C = idx[t + 2];
      const e1 = [P3[B * 3] - P3[A * 3], P3[B * 3 + 1] - P3[A * 3 + 1], P3[B * 3 + 2] - P3[A * 3 + 2]];
      const e2 = [P3[C * 3] - P3[A * 3], P3[C * 3 + 1] - P3[A * 3 + 1], P3[C * 3 + 2] - P3[A * 3 + 2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
      const nx = N3[A * 3] + N3[B * 3] + N3[C * 3], ny = N3[A * 3 + 1] + N3[B * 3 + 1] + N3[C * 3 + 1], nz = N3[A * 3 + 2] + N3[B * 3 + 2] + N3[C * 3 + 2];
      if (cx * nx + cy * ny + cz * nz < 0) { idx[t + 1] = C; idx[t + 2] = B; }
    }
    return {
      position: new Float32Array(pos), normal: new Float32Array(nor), piece: new Float32Array(pid), kind: new Float32Array(kind), dimp: new Float32Array(dimp),
      index: vcount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), pieceRange, vertexCount: vcount, triangles: idx.length / 3,
    };
  }

  // crack lines for drawing: each segment carries its piece, its times and whether it
  // separates two pieces (otherwise it is a crack that stopped inside a piece)
  function buildCrackLines(prof, chart, cr, L, pieces) {
    const { nphi, nv, dphi, dv } = chart;
    const pos = [], pid = [], tt = [], inner = [];
    const labAt = (X, Y) => { const j = clamp(Math.floor(Y), 0, nv - 1); const i = ((Math.floor(X) % nphi) + nphi) % nphi; return L.lab[i + j * nphi]; };
    const lift = 0.00012;
    for (const c of cr.cracks) {
      for (let s = 0; s + 1 < c.t.length; s++) {
        let X0 = c.ch[2 * s], Y0 = c.ch[2 * s + 1], X1 = c.ch[2 * s + 2], Y1 = c.ch[2 * s + 3];
        while (X1 - X0 > nphi / 2) X1 -= nphi;
        while (X1 - X0 < -nphi / 2) X1 += nphi;
        const mx = 0.5 * (X0 + X1), my = 0.5 * (Y0 + Y1);
        let ex = X1 - X0, ey = Y1 - Y0; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
        const la = labAt(mx - ey * 0.7, my + ex * 0.7), lb = labAt(mx + ey * 0.7, my - ex * 0.7);
        const q = labAt(mx, my);
        const com = pieces[q].com;
        for (const [X, Y, T] of [[X0, Y0, c.t[s]], [X1, Y1, c.t[s + 1]]]) {
          const phi = X * dphi, v = clamp(Y * dv, 0, prof.L);
          const p = outerPoint(prof, phi, v), nn = outerNormal(prof, phi, v);
          pos.push(p[0] + nn[0] * lift - com[0], p[1] + nn[1] * lift - com[1], p[2] + nn[2] * lift - com[2]);
          pid.push(q); tt.push(T); inner.push(la === lb ? 1 : 0);
        }
      }
    }
    return { position: new Float32Array(pos), piece: new Float32Array(pid), time: new Float32Array(tt), inner: new Float32Array(inner) };
  }

  // collision patches: each piece is covered by small boxes, one per block of cells
  function buildPatches(prof, chart, L, pieces, blockMM) {
    const { nphi, nv, dphi, dv, rowR } = chart;
    const B = Math.max(2, Math.round(blockMM / 1000 / chart.h));
    const rmax = Math.max(...rowR);
    const groups = new Map();
    for (let k = 0; k < chart.n; k++) {
      const i = k % nphi, j = (k - i) / nphi;
      const colsPer = Math.min(nphi, Math.max(B, Math.round(B * rmax / Math.max(rowR[j], chart.h))));
      const key = L.lab[k] * 1e7 + Math.floor(j / B) * 1e4 + Math.floor(i / colsPer);
      let g = groups.get(key);
      if (!g) { g = { q: L.lab[k], cells: [] }; groups.set(key, g); }
      g.cells.push(k);
    }
    const out = pieces.map(() => []);
    for (const g of groups.values()) {
      const com = pieces[g.q].com;
      // centre and frame
      let c = [0, 0, 0], nrm = [0, 0, 0], phiS = 0, phiC = 0, vS = 0;
      const pts = [];
      for (const k of g.cells) {
        const i = k % nphi, j = (k - i) / nphi;
        for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const phi = (i + di) * dphi, v = Math.min(prof.L, (j + dj) * dv);
          pts.push(outerPoint(prof, phi, v), innerPoint(prof, phi, v));
        }
        const phi = (i + 0.5) * dphi, v = (j + 0.5) * dv;
        const nn = outerNormal(prof, phi, v);
        nrm[0] += nn[0]; nrm[1] += nn[1]; nrm[2] += nn[2];
        phiS += Math.sin(phi); phiC += Math.cos(phi); vS += v;
      }
      for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
      c = c.map(x => x / pts.length);
      let l = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1; nrm = nrm.map(x => x / l);
      const phiM = Math.atan2(phiS, phiC);
      let t1 = [-Math.sin(phiM), 0, Math.cos(phiM)];
      const dn = t1[0] * nrm[0] + t1[1] * nrm[1] + t1[2] * nrm[2];
      t1 = [t1[0] - dn * nrm[0], t1[1] - dn * nrm[1], t1[2] - dn * nrm[2]];
      l = Math.hypot(t1[0], t1[1], t1[2]);
      if (l < 1e-6) { t1 = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]; const d2 = t1[0] * nrm[0] + t1[1] * nrm[1] + t1[2] * nrm[2]; t1 = [t1[0] - d2 * nrm[0], t1[1] - d2 * nrm[1], t1[2] - d2 * nrm[2]]; l = Math.hypot(t1[0], t1[1], t1[2]); }
      t1 = t1.map(x => x / l);
      const t2 = [nrm[1] * t1[2] - nrm[2] * t1[1], nrm[2] * t1[0] - nrm[0] * t1[2], nrm[0] * t1[1] - nrm[1] * t1[0]];
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      const ax = [t1, t2, nrm];
      for (const p of pts) {
        const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        for (let a = 0; a < 3; a++) { const s = d[0] * ax[a][0] + d[1] * ax[a][1] + d[2] * ax[a][2]; if (s < lo[a]) lo[a] = s; if (s > hi[a]) hi[a] = s; }
      }
      // hull points: cell centres ± 0.2 cell, so neighbouring pieces start with a gap
      const hp = [];
      // only the outline of the patch, thinned: the hull of a curved patch needs no more
      const rowMin = new Map(), rowMax = new Map(), colMin = new Map(), colMax = new Map();
      const unwrap = (i) => { let x = i; const i0 = g.cells[0] % nphi; while (x - i0 > nphi / 2) x -= nphi; while (x - i0 < -nphi / 2) x += nphi; return x; };
      for (const k of g.cells) {
        const i = unwrap(k % nphi), j = (k - (k % nphi)) / nphi;
        if (!rowMin.has(j) || i < rowMin.get(j)) rowMin.set(j, i);
        if (!rowMax.has(j) || i > rowMax.get(j)) rowMax.set(j, i);
        if (!colMin.has(i) || j < colMin.get(i)) colMin.set(i, j);
        if (!colMax.has(i) || j > colMax.get(i)) colMax.set(i, j);
      }
      const keep = [];
      for (const k of g.cells) {
        const i = unwrap(k % nphi), j = (k - (k % nphi)) / nphi;
        const edge = i === rowMin.get(j) || i === rowMax.get(j) || j === colMin.get(i) || j === colMax.get(i);
        const corner = (i === rowMin.get(j) || i === rowMax.get(j)) && (j === colMin.get(i) || j === colMax.get(i));
        if (corner || (edge && ((i + j) % 3 === 0))) keep.push(k);
      }
      for (const k of keep) {
        const i = k % nphi, j = (k - i) / nphi;
        for (const [di, dj] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
          const phi = (i + di) * dphi, v = Math.min(prof.L, (j + dj) * dv);
          const a = outerPoint(prof, phi, v), b = innerPoint(prof, phi, v);
          const fo = 0.12; // pull the faces in a little too
          hp.push(a[0] + fo * (b[0] - a[0]) - com[0], a[1] + fo * (b[1] - a[1]) - com[1], a[2] + fo * (b[2] - a[2]) - com[2]);
          hp.push(b[0] + fo * (a[0] - b[0]) - com[0], b[1] + fo * (a[1] - b[1]) - com[1], b[2] + fo * (a[2] - b[2]) - com[2]);
        }
      }
      const half = [0, 1, 2].map(a => Math.max(0.0004, 0.5 * (hi[a] - lo[a])));
      const mid = [0, 1, 2].map(a => 0.5 * (hi[a] + lo[a]));
      const centre = [0, 1, 2].map(m => c[m] + mid[0] * ax[0][m] + mid[1] * ax[1][m] + mid[2] * ax[2][m] - com[m]);
      out[g.q].push({ centre, half, q: quatFromBasis(t1, t2, nrm), hull: new Float32Array(hp) });
    }
    return out;
  }
  function quatFromBasis(x, y, z) {
    // columns x, y, z of a rotation matrix
    const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
    const tr = m00 + m11 + m22;
    let qx, qy, qz, qw;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; qw = 0.25 * s; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s; }
    const l = Math.hypot(qx, qy, qz, qw);
    return [qx / l, qy / l, qz / l, qw / l];
  }

  // ---------------------------------------------------------------- launch
  // Velocity each piece gets from the energy released around it, in the cup frame.
  function launch(P, pieces, imp, rng) {
    const gp = imp.gp;
    const c = imp.seedCentre;
    return pieces.map(pc => {
      const tAvg = pc.mass / (gp.rho * pc.area);
      const vk = Math.sqrt(2 * P.kick * pc.e / (gp.rho * tAvg)) * (0.7 + 0.6 * rng());
      // away from the impact, plus outward from the glass
      let d = [pc.com[0] - c[0], pc.com[1] - c[1], pc.com[2] - c[2]];
      const dl = Math.hypot(d[0], d[1], d[2]) || 1; d = d.map(x => x / dl);
      const rr = Math.hypot(pc.com[0], pc.com[2]) || 1;
      const out = [pc.com[0] / rr, 0.2, pc.com[2] / rr];
      const resShare = imp.uRes > 0 ? clamp(imp.uRes * tAvg / Math.max(1e-9, pc.e), 0, 1) : 0;
      const a = 1 - resShare;
      let v = [a * d[0] + (1 - a + 0.3) * out[0] + 0.3 * gauss(rng) * 0.4, a * d[1] + (1 - a + 0.3) * out[1] + 0.3 * gauss(rng) * 0.4, a * d[2] + (1 - a + 0.3) * out[2] + 0.3 * gauss(rng) * 0.4];
      const vl = Math.hypot(v[0], v[1], v[2]) || 1; v = v.map(x => x / vl * vk);
      const w = vk / Math.max(0.002, pc.size) * 0.35;
      let ax = [gauss(rng), gauss(rng), gauss(rng)]; const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
      return { v, w: ax.map(x => x / al * w * (0.5 + rng())) };
    });
  }

  // ---------------------------------------------------------------- statistics
  function stats(pieces, totalMass, minCells) {
    const sorted = pieces.slice().sort((a, b) => b.mass - a.mass);
    const big = sorted[0] ? sorted[0].mass / totalMass : 0;
    const sizes = pieces.map(p => p.size);
    const bins = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 1];
    const hist = new Array(bins.length).fill(0), massHist = new Array(bins.length).fill(0);
    for (const p of pieces) { let b = 0; while (b < bins.length - 1 && p.size > bins[b]) b++; hist[b]++; massHist[b] += p.mass / totalMass; }
    const dust = pieces.filter(p => p.cells < minCells).length;
    return { count: pieces.length, dust, biggest: big, hist, massHist, bins,
      over1cm: sizes.filter(s => s >= 0.01).length, under3mm: sizes.filter(s => s < 0.003).length };
  }

  // ---------------------------------------------------------------- everything
  function run(P, opts = {}) {
    const rng = rngFrom(P.seed * 2654435761 + 12345);
    const prof = buildProfile(P);
    const chart = buildChart(prof, P.cell);
    const imp = impact(P, prof, chart, rng);
    const dist = dijkstra(chart, imp.seeds);
    const field = energyField(P, chart, imp, dist);
    const cr = growCracks(P, prof, chart, imp, field, dist, rng);
    const L = labelPieces(chart, cr);
    const pieces = pieceProps(prof, chart, cr, L, imp.gp.rho, field);
    const st = stats(pieces, imp.M, opts.minCells || 4);
    const res = { P, prof, chart, imp, dist, field, cr, L, pieces, stats: st };
    if (opts.mesh) {
      res.mesh = buildMesh(prof, chart, cr, L, pieces, dist);
      res.lines = buildCrackLines(prof, chart, cr, L, pieces);
      res.patches = buildPatches(prof, chart, L, pieces, opts.blockMM || 5);
      res.launch = launch(P, pieces, imp, rng);
    }
    return res;
  }
  return { TAU, G, GLASSES, FLOORS, SHAPES, defaults, shapeDefaults, rngFrom, gauss, glassProps, buildProfile, buildChart, pAt, outerPoint, innerPoint, outerNormal, innerNormal,
    cupRotation, rotZ, impact, dijkstra, energyField, growCracks, labelPieces, pieceProps, buildMesh, buildCrackLines, launch, run };
})();
export default GlassCore;

// Hand-modelled signature buildings, built from real dimensions and placed on their OSM footprints:
// Transamerica Pyramid, Salesforce Tower, 555 California (Bank of America Center), Ferry Building,
// Embarcadero Center 1-4, Millennium Tower, 181 Fremont, Coit Tower.
// claimLandmarks() runs BEFORE the generic building pass and tags the OSM parts it replaces (b._lm), so the
// generic builder emits neither geometry nor colliders for them; Landmarks.build() then adds the replacement
// geometry (same vertex layout / material as Buildings.js, so all landmarks are ONE extra draw call) and
// colliders. Every landmark falls back to its real lat/lon if its OSM parts are missing.
// Plugged into the engine MapWorld by landmarksPlugin() (src/world/World.js): beforeBuildings = claimLandmarks,
// afterBuildings = Landmarks.build, clearZones = landmarkClearZones.
import * as THREE from 'three';
import { GeoBuf, MODE, enc, tintOf, insetRing, offsetRing } from '@vibe/engine/world';
import { FACADE, PBR } from '@vibe/engine/world';
import { polygonToBoxes } from '@vibe/engine/physics';
import { signedArea, sanitizeRing, centroid, clamp } from '@vibe/engine/world';

const CENTER = { lat: 37.792, lon: -122.3965 }; // bake frame origin (tools/bake-map.mjs)
const R_E = 6378137, DEG = Math.PI / 180;
/** lat/lon -> bake frame metres (x east, z south). */
export function bakeXZ(lat, lon) { return [(lon - CENTER.lon) * DEG * R_E * Math.cos(CENTER.lat * DEG), -(lat - CENTER.lat) * DEG * R_E]; }

const DEFS = [
  { key: 'transamerica', re: /^Transamerica Pyramid$/i, ll: [37.79520, -122.40279] },
  { key: 'salesforce', re: /^Salesforce Tower$/i, ll: [37.78975, -122.39686] },
  { key: 'bofa', re: /^555 California Street$/i, ll: [37.79205, -122.40360] },
  { key: 'ferry', re: /^San Francisco Ferry Building$/i, ll: [37.79554, -122.39343] },
  { key: 'ec1', re: /^Embarcadero Center 1$/i, ll: [37.79474, -122.39985] },
  { key: 'ec2', re: /^Embarcadero Center 2$/i, ll: [37.79457, -122.39875] },
  { key: 'ec3', re: /^Embarcadero Center 3$/i, ll: [37.79443, -122.39766] },
  { key: 'ec4', re: /^Embarcadero Center 4$/i, ll: [37.79432, -122.39637] },
  { key: 'millennium', re: /^Millennium Tower$/i, ll: [37.79054, -122.39622] },
  { key: 'fremont181', re: /^181 Fremont( Tower)?$/i, ll: [37.78970, -122.39530] },
];
/** Coit Tower sits on Telegraph Hill, outside the OSM district (filler ring): keep filler lots off Pioneer Park. */
export const COIT = { ll: [37.802389, -122.405833] };
export function landmarkClearZones() { const [x, z] = bakeXZ(...COIT.ll); return [{ x, z, r: 140 }]; } // bake frame

/** Tag OSM buildings replaced by hand-modelled landmarks (b._lm = key). Returns {key: [buildings]}. */
export function claimLandmarks(data) {
  const out = {};
  for (const b of (data && data.buildings) || []) {
    if (!b || !b.n || b.lod) continue;
    const d = DEFS.find((e) => e.re.test(String(b.n).trim()));
    if (!d) continue;
    b._lm = d.key;
    (out[d.key] = out[d.key] || []).push(b);
  }
  data._landmarkClaims = out;
  return out;
}

// ------------------------------------------------------------------ small geometry kit (Buildings.js vertex layout)
const tint = (r, g, b) => tintOf(r, g, b);
const inf = (pbr, mode, layer = -1, store = -1, seed = 0.5) => [layer, store, seed, enc(pbr, mode)];
function posRing(r) { return signedArea(r) > 0 ? r : r.slice().reverse(); }
function ringLen(r) { let L = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); } return L; }
/** Rounded square (positive area), centre c, rotation ang, half-width hw, corner radius cr. */
function roundedSquare(cx, cz, ang, hw, cr, seg = 6) {
  const pts = [], ca = Math.cos(ang), sa = Math.sin(ang);
  cr = Math.min(cr, hw * 0.98);
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let k = 0; k < 4; k++) {
    const [sx, sz] = corners[k];
    const ox = sx * (hw - cr), oz = sz * (hw - cr);
    const a0 = Math.atan2(sz, sx) - Math.PI / 4;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      const x = ox + Math.cos(a) * cr, z = oz + Math.sin(a) * cr;
      pts.push([cx + x * ca - z * sa, cz + x * sa + z * ca]);
    }
  }
  return posRing(pts);
}
/** Walls between rings (same vertex count, positive area) at heights ys. u from the first ring's arc length. */
function loft(buf, rings, ys, info, tnt, { bayW = 3, floorH = 3.8, u0 = 0, closed = true, fuv = null } = {}) {
  const n = rings[0].length;
  const cu = [0];
  for (let i = 1; i <= n; i++) { const a = rings[0][i - 1], b = rings[0][i % n]; cu.push(cu[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  for (let k = 0; k + 1 < rings.length; k++) {
    const A = rings[k], Bq = rings[k + 1], y0 = ys[k], y1 = ys[k + 1];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      const p0 = [A[i][0], y0, A[i][1]], p1 = [A[j][0], y0, A[j][1]], p2 = [Bq[j][0], y1, Bq[j][1]], p3 = [Bq[i][0], y1, Bq[i][1]];
      // flat outward normal
      const ex = p1[0] - p0[0], ez = p1[2] - p0[2], L = Math.hypot(ex, ez);
      if (L < 1e-4 && Math.hypot(p2[0] - p3[0], p2[2] - p3[2]) < 1e-4) continue;
      const ux = p2[0] - p0[0], uy = p2[1] - p0[1], uz = p2[2] - p0[2], vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      if (L > 1e-4 ? nx * ez - nz * ex < 0 : false) { nx = -nx; ny = -ny; nz = -nz; } // outward = (dz,-dx) side for positive rings
      const uu = [u0 + cu[i] / bayW, u0 + cu[i + 1] / bayW];
      const uv = fuv ? (p, q) => fuv(p, q, i, k) : (p, q) => [q === 0 || q === 3 ? uu[0] : uu[1], p[1] / floorH];
      buf.q([p0, p1, p2, p3], [nx, ny, nz], info, tnt, uv);
    }
  }
}
function cap(buf, ring, y, info, tnt, up = true) {
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []); } catch { return; }
  const k = ring.map((p) => buf.v(p[0], y, p[1], 0, up ? 1 : -1, 0, p[0] / 3, p[1] / 3, info, tnt));
  for (const f of faces) buf.tri(k[f[0]], k[f[1]], k[f[2]]);
}
/** Oriented box from 8 corners helper: centre, half extents along (dir, perp), y range. */
function obox(buf, cx, cz, dx, dz, hl, hw, y0, y1, info, tnt, { top = true, bottom = false, fuv = null } = {}) {
  const px = -dz, pz = dx;
  const C = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([a, b]) => [cx + dx * a + px * b, cz + dz * a + pz * b]);
  const ring = posRing(C);
  loft(buf, [ring, ring], [y0, y1], info, tnt, fuv ? { fuv } : { bayW: 3, floorH: 3.8 });
  if (top) cap(buf, ring, y1, info, tnt, true);
  if (bottom) cap(buf, ring, y0, info, tnt, false);
  return ring;
}
/** Thin strip between two 3D points, offset along normal n by e, width w (both faces optional). */
function beam(buf, a, b, n, w, depth, info, tnt, uvf = null) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
  const d = [dx / L, dy / L, dz / L];
  // side vector = n x d
  let sx = n[1] * d[2] - n[2] * d[1], sy = n[2] * d[0] - n[0] * d[2], sz = n[0] * d[1] - n[1] * d[0];
  const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const hw = w / 2;
  const P = (p, s, e) => [p[0] + sx * s + n[0] * e, p[1] + sy * s + n[1] * e, p[2] + sz * s + n[2] * e];
  buf.q([P(a, -hw, depth), P(b, -hw, depth), P(b, hw, depth), P(a, hw, depth)], n, info, tnt, uvf);
  buf.q([P(a, -hw, 0), P(b, -hw, 0), P(b, -hw, depth), P(a, -hw, depth)], [-sx, -sy, -sz], info, tnt, uvf);
  buf.q([P(a, hw, 0), P(b, hw, 0), P(b, hw, depth), P(a, hw, depth)], [sx, sy, sz], info, tnt, uvf);
}
function partsInfo(parts) {
  let all = [];
  for (const b of parts) { const r = sanitizeRing(b.p); if (r) all = all.concat(r); }
  if (!all.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, sx = 0, sz = 0;
  for (const [x, z] of all) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); sx += x; sz += z; }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, mx: sx / all.length, mz: sz / all.length, minX, maxX, minZ, maxZ, pts: all };
}
function edgeAngle(ring) { // direction of the longest edge
  let best = 0, ang = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  return ang;
}

// ------------------------------------------------------------------ the module
export class Landmarks {
  constructor({ world, data, colliders, mat, tex, groundAt }) {
    this.world = world; this.data = data; this.colliders = colliders; this.mat = mat; this.tex = tex; this.groundAt = groundAt || (() => 0);
    this.count = 0; this.stats = {}; this.time = 0;
  }

  /** Build meshes; return a THREE.Object3D or null. */
  build() {
    if (this.world && this.world.source === 'procedural') return null; // real landmarks need the real (OSM) city
    const claims = (this.data && this.data._landmarkClaims) || claimLandmarks(this.data || { buildings: [] });
    const off = (this.world && this.world.offset) || { x: 0, z: 0 };
    this.off = off;
    const where = (key) => {
      const parts = claims[key] || [];
      const pi = partsInfo(parts);
      if (pi) return { parts, ...pi };
      const d = DEFS.find((e) => e.key === key);
      const [x, z] = bakeXZ(...d.ll);
      return { parts: [], cx: x - off.x, cz: z - off.z, mx: x - off.x, mz: z - off.z, pts: [] };
    };
    const set = this.mat && this.mat.facadeSet;
    if (!set) { console.warn('[Landmarks] no facade materials'); return null; }
    const g = new THREE.Group(); g.name = 'landmarks';
    const jobs = [
      ['transamerica', () => this.transamerica(where('transamerica'))],
      ['salesforce', () => this.salesforce(where('salesforce'))],
      ['bofa', () => this.bofa(where('bofa'))],
      ['ferry', () => this.ferry(where('ferry'))],
      ['ec', () => { for (const k of ['ec1', 'ec2', 'ec3', 'ec4']) this.embarcadero(where(k), k); }],
      ['millennium', () => this.millennium(where('millennium'))],
      ['fremont181', () => this.fremont181(where('fremont181'))],
      ['coit', () => this.coit()],
    ];
    // two buffers (west / east halves) so frustum culling can drop one
    this.bufs = [new GeoBuf(8192), new GeoBuf(8192)];
    for (const [name, fn] of jobs) {
      try {
        const t0 = this.bufs[0].tris + this.bufs[1].tris;
        fn();
        this.stats[name] = Math.round(this.bufs[0].tris + this.bufs[1].tris - t0);
        this.count++;
      } catch (e) { console.warn(`[Landmarks] ${name} failed`, e); }
    }
    for (const b of this.bufs) { const m = b.build(set, 'landmarks'); if (m) g.add(m); }
    this.group = g;
    console.info('[Landmarks]', this.count, 'built, triangles', this.stats);
    return g;
  }
  bufAt(x) { return this.bufs[x < -150 ? 0 : 1]; }
  col(ring, y0, y1) {
    if (!this.colliders || !(y1 > y0)) return;
    for (const b of polygonToBoxes(ring, [], 1.5)) this.colliders.add(b[0], y0, b[2], y1, b[1], b[3], 1);
  }
  baseOf(pts) {
    let m = Infinity;
    for (const p of pts) m = Math.min(m, this.groundAt(p[0], p[1]));
    return Number.isFinite(m) ? m : 0;
  }

  // ================================================================ Transamerica Pyramid (260 m)
  transamerica(w) {
    // orientation from the widest OSM tier, centre from the base parts
    let ang = 0.0, cx = w.cx, cz = w.cz;
    const tier = w.parts.filter((b) => b.p && b.p.length === 4).sort((a, b) => Math.abs(signedArea(b.p)) - Math.abs(signedArea(a.p)))[0];
    if (tier) { const r = sanitizeRing(tier.p); ang = edgeAngle(r); const c = centroid(r); cx = c[0]; cz = c[1]; } else ang = -0.163;
    const B = this.bufAt(cx);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const sq = (hw, x0 = 0, z0 = 0) => posRing([[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]].map(([x, z]) => [cx + (x + x0) * ca - (z + z0) * sa, cz + (x + x0) * sa + (z + z0) * ca]));
    const y0 = this.baseOf(sq(27)), H = 260, HW0 = 26.6, slope = HW0 / H;
    const hwAt = (y) => HW0 - slope * y;
    const white = tint(0.99, 0.98, 0.95), whiteW = inf(PBR.CONCRETE_PANEL, MODE.WALL, FACADE.SMALL, -1, 0.31);
    // lobby (recessed glass) + sloped columns of the base truss
    const lobbyH = 16;
    loft(B, [sq(21.5), sq(21.5)], [y0 - 1, y0 + lobbyH], inf(PBR.PLAIN, MODE.CURTAIN, 1, -1, 0.2), tint(0.72, 0.78, 0.8), { bayW: 1.5, floorH: 5.3 });
    for (let k = 0; k < 4; k++) {
      for (let i = -3; i <= 3; i++) {
        const t = i / 3.4;
        const pAt = (y) => { const hw = hwAt(y - y0) - 1.2; const lx = [hw, t * hw, -hw, -t * hw][k], lz = [t * hw, hw, -t * hw, -hw][k]; return [cx + lx * ca - lz * sa, y, cz + lx * sa + lz * ca]; };
        const n = [[ca, 0, sa], [-sa, 0, ca], [-ca, 0, -sa], [sa, 0, -ca]][k];
        beam(B, pAt(y0 - 1), pAt(y0 + lobbyH + 0.5), n, 1.1, 1.2, inf(PBR.CONCRETE_PANEL, MODE.PLAIN), white);
      }
    }
    // pyramid body: punched quartz-aggregate facade (tiers so the face stays planar per band)
    const ys = [lobbyH, 60, 110, 160, 212].map((y) => y0 + y);
    const rings = ys.map((y) => sq(hwAt(y - y0)));
    const faceU = (p) => { // u = horizontal distance from the face centre line (so window columns are cut by the slope)
      const lx = (p[0] - cx) * ca + (p[2] - cz) * sa, lz = -(p[0] - cx) * sa + (p[2] - cz) * ca;
      return Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? lz : -lz) : (lz > 0 ? -lx : lx);
    };
    loft(B, rings, ys, whiteW, white, { fuv: (p) => [faceU(p) / 2.2 + 40, (p[1] - y0) / 3.9] });
    // spire (aluminium panels) to 260 m + beacon
    const yS = y0 + 212, hS = hwAt(212);
    const apex = [cx, y0 + H, cz], base = sq(hS);
    for (let i = 0; i < 4; i++) {
      const a = base[i], b = base[(i + 1) % 4];
      const P = [[a[0], yS, a[1]], [b[0], yS, b[1]], apex];
      const e1 = [P[1][0] - P[0][0], 0, P[1][2] - P[0][2]], e2 = [apex[0] - P[0][0], apex[1] - P[0][1], apex[2] - P[0][2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
      if (n[0] * mx + n[2] * mz < 0) n = n.map((v) => -v);
      const l = Math.hypot(...n); n = n.map((v) => v / l);
      B.poly(P, n, inf(PBR.METAL, MODE.PLAIN), tint(0.9, 0.91, 0.92));
    }
    obox(B, cx, cz, ca, sa, 0.35, 0.35, y0 + H - 0.5, y0 + H + 0.4, [2, -1, 0.1, enc(PBR.PLAIN, MODE.LED)], tint(1, 0.2, 0.1));
    // the two "wings": elevator shaft (east, blank) and stair / smoke tower (west, small windows)
    for (const sgn of [1, -1]) {
      const wy0 = y0 + 104, wy1 = y0 + 214, dOut = hwAt(104) - 0.2, dIn = 4;
      const lc = (dOut + dIn) / 2, hl = (dOut - dIn) / 2, hw = 5.2;
      const wcx = cx + sgn * lc * ca, wcz = cz + sgn * lc * sa;
      obox(B, wcx, wcz, ca, sa, hl, hw, wy0, wy1, inf(PBR.CONCRETE_PANEL, MODE.WALLONLY), white);
    }
    // colliders: stacked bands
    for (let y = 0; y < 212; y += 12) this.col(sq(hwAt(y)), y0 + y - (y === 0 ? 1 : 0), y0 + y + 12);
    this.col(sq(hwAt(212)), y0 + 212, y0 + 240);
    this.stats.transamericaBase = +y0.toFixed(1);
  }

  // ================================================================ Salesforce Tower (326 m)
  salesforce(w) {
    let cx = w.cx, cz = w.cz;
    const ang = Math.PI / 4 + 0.0; // sides parallel to the SoMa grid (corners point N/E/S/W in the bake frame)
    const B = this.bufAt(cx);
    const y0 = this.baseOf([[cx - 25, cz], [cx + 25, cz], [cx, cz - 25], [cx, cz + 25]]);
    // profile: half-width / corner radius by height (gentle taper, crown rounds inward)
    const prof = [[0, 27.2], [40, 27.1], [120, 26.6], [200, 25.6], [250, 24.6], [272, 23.9], [292, 22.6], [308, 21.0], [318, 19.4], [326, 17.8]];
    const ring = (hw) => roundedSquare(cx, cz, ang, hw, hw * 0.55, 5);
    const crownY = 272;
    const shaft = prof.filter(([y]) => y <= crownY);
    const glass = inf(PBR.PLAIN, MODE.CURTAIN, 3, -1, 0.42), gt = tint(0.74, 0.8, 0.86);
    loft(B, shaft.map(([, hw]) => ring(hw)), shaft.map(([y]) => y0 + y - (y === 0 ? 1 : 0)), glass, gt, { bayW: 1.55, floorH: 4.4 });
    // crown: inner core + open lattice of fins and rings with the LED screen
    const core = prof.filter(([y]) => y >= crownY).map(([y, hw]) => [y, hw * 0.62]);
    loft(B, core.map(([, hw]) => ring(hw)), core.map(([y]) => y0 + y), inf(PBR.CONCRETE_PANEL, MODE.PLAIN), tint(0.55, 0.57, 0.6));
    cap(B, ring(core[core.length - 1][1]), y0 + 326, inf(PBR.ROOF_TAR, MODE.PLAIN), tint(0.4, 0.4, 0.42));
    cap(B, ring(prof.find(([y]) => y === crownY)[1]), y0 + crownY, inf(PBR.ROOF_TAR, MODE.PLAIN), tint(0.45, 0.45, 0.47));
    const crown = prof.filter(([y]) => y >= crownY);
    const nF = 72;
    const finInfo = [1, -1, 0.5, enc(PBR.PLAIN, MODE.LED)], finT = tint(0.88, 0.9, 0.92);
    const perim = (hw) => { const r = ring(hw); return { r, L: ringLen(r) }; };
    const at = (hw, t) => { // point at arc fraction t along the ring
      const { r, L } = perim(hw); let s = t * L;
      for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (s <= l) return [a[0] + (b[0] - a[0]) * (s / l), a[1] + (b[1] - a[1]) * (s / l), (b[1] - a[1]) / l, -(b[0] - a[0]) / l]; s -= l; }
      return [r[0][0], r[0][1], 1, 0];
    };
    for (let f = 0; f < nF; f++) {
      const t = f / nF;
      for (let k = 0; k + 1 < crown.length; k++) {
        const [ya, ha] = crown[k], [yb, hb] = crown[k + 1];
        const A = at(ha, t), Bp = at(hb, t);
        const n = [A[2], 0, A[3]];
        const pa = [A[0] - A[2] * 2.2, y0 + ya, A[1] - A[3] * 2.2], pb = [Bp[0] - Bp[2] * 2.2, y0 + yb, Bp[1] - Bp[3] * 2.2];
        beam(B, pa, pb, n, 0.55, 2.2, finInfo, finT, (p) => [f * 1.1, p[1] - y0]);
      }
    }
    // horizontal rings of the lattice
    for (const [y, hw] of crown.filter((_, i) => i % 1 === 0)) {
      const r1 = ring(hw), r2 = ring(hw - 0.6);
      loft(B, [r1, r1], [y0 + y - 0.35, y0 + y + 0.35], finInfo, finT, { fuv: (p) => [0, p[1] - y0] });
      loft(B, [r2, r2].map((r) => r.slice().reverse()), [y0 + y - 0.35, y0 + y + 0.35], inf(PBR.PLAIN, MODE.PLAIN), finT);
    }
    obox(B, cx, cz, 1, 0, 0.3, 0.3, y0 + 326, y0 + 333, inf(PBR.METAL, MODE.PLAIN), tint(0.7, 0.7, 0.72));
    obox(B, cx, cz, 1, 0, 0.35, 0.35, y0 + 333, y0 + 333.6, [2, -1, 0.3, enc(PBR.PLAIN, MODE.LED)], tint(1, 0.2, 0.1));
    // colliders
    for (let k = 0; k + 1 < prof.length; k++) this.col(ring(prof[k][1]), y0 + prof[k][0] - (k ? 0 : 1), y0 + prof[k + 1][0]);
  }

  // ================================================================ 555 California (Bank of America Center, 237 m)
  bofa(w) {
    const parts = w.parts.filter((b) => sanitizeRing(b.p) && (b.h || 0) > 5).sort((a, b) => (a.h || 0) - (b.h || 0));
    const carnelian = tint(0.5, 0.31, 0.27), base = this.baseOf(w.pts.length ? w.pts : [[w.cx, w.cz]]);
    const B = this.bufAt(w.cx);
    if (!parts.length) { // fallback: serrated box
      const r = roundedSquare(w.cx, w.cz, 0.15, 30, 2, 1);
      loft(B, [r, r], [base - 1, base + 237], inf(PBR.GRANITE, MODE.WALL, FACADE.VERTICAL, -1, 0.6), carnelian, { bayW: 1.7, floorH: 4.1 });
      cap(B, r, base + 237, inf(PBR.ROOF_TAR, MODE.PLAIN), tint(0.3, 0.28, 0.27));
      this.col(r, base - 1, base + 237);
      return;
    }
    for (const b of parts) {
      const r = posRing(sanitizeRing(b.p));
      const h = b.h, mh = b.mh || 0;
      const y0 = mh > 0 ? base + mh : base - 1;
      // two-storey granite and glass base, then the bay-window shaft with narrow vertical windows
      if (h > 20 && mh < 1) {
        loft(B, [r, r], [y0, base + 9], inf(PBR.GRANITE, MODE.WALL, FACADE.STOREFRONT, -1, 0.6), tint(0.42, 0.28, 0.26), { bayW: 3.4, floorH: 9 });
        loft(B, [r, r], [base + 9, base + h], inf(PBR.GRANITE, MODE.WALL, FACADE.VERTICAL, -1, 0.61), carnelian, { bayW: 1.7, floorH: 4.15 });
      } else loft(B, [r, r], [y0, base + h], inf(PBR.GRANITE, MODE.WALL, h > 20 ? FACADE.VERTICAL : FACADE.STOREFRONT, -1, 0.62), carnelian, { bayW: 1.7, floorH: 4.15 });
      cap(B, r, base + h, inf(PBR.ROOF_TAR, MODE.PLAIN), tint(0.32, 0.3, 0.3));
      this.col(r, y0, base + h);
    }
    // stepped crown: dark granite parapet bands on the top parts
    for (const b of parts.filter((p) => p.h > 200)) {
      const r = posRing(sanitizeRing(b.p)), o = offsetRing(r, 0.15);
      loft(B, [o, o], [base + b.h - 2.5, base + b.h + 1.2], inf(PBR.GRANITE, MODE.PLAIN), tint(0.5, 0.31, 0.27));
      const ins = insetRing(r, 0.5);
      if (ins) loft(B, [ins, ins].map((q) => q.slice().reverse()), [base + b.h, base + b.h + 1.2], inf(PBR.GRANITE, MODE.PLAIN), tint(0.45, 0.3, 0.27));
    }
  }

  // ================================================================ Ferry Building (clock tower 75 m, 200 m hall)
  ferry(w) {
    // axis from the main hall footprint (longest edge), tower from the tall parts
    const hall = w.parts.filter((b) => (b.h || 0) < 30).sort((a, b) => Math.abs(signedArea(b.p)) - Math.abs(signedArea(a.p)))[0];
    const tall = w.parts.filter((b) => (b.h || 0) >= 30);
    let tx, tz;
    if (tall.length) { const pi = partsInfo(tall); tx = pi.cx; tz = pi.cz; } else { tx = w.cx; tz = w.cz; }
    let ux = 0.59, uz = 0.81, hallRing = null;
    if (hall) { hallRing = posRing(sanitizeRing(hall.p)); const a = edgeAngle(hallRing); ux = Math.cos(a); uz = Math.sin(a); }
    // n = outward normal of the city-side front (points away from the hall centroid)
    let nx = -uz, nz = ux;
    if (hallRing) { const c = centroid(hallRing); if ((tx - c[0]) * nx + (tz - c[1]) * nz < 0) { nx = -nx; nz = -nz; } }
    // hall extents in the tower frame: s along the axis, t inward from the tower centre (t > 0 towards the bay)
    let s0 = -100, s1 = 100, tBack = 34, tF = 3;
    if (hallRing) {
      s0 = Infinity; s1 = -Infinity; let tmax = -Infinity, tfront = Infinity;
      for (const [x, z] of hallRing) {
        const s = (x - tx) * ux + (z - tz) * uz, t = -((x - tx) * nx + (z - tz) * nz);
        s0 = Math.min(s0, s); s1 = Math.max(s1, s); tmax = Math.max(tmax, t);
        if (Math.abs(s) > 20) tfront = Math.min(tfront, t);
      }
      tBack = Math.min(tmax, 34); tF = Number.isFinite(tfront) ? tfront : 3;
    }
    const W = (s, t) => [tx + ux * s - nx * t, tz + uz * s - nz * t];
    const P3 = (s, y, t) => { const p = W(s, t); return [p[0], y, p[1]]; };
    const B = this.bufAt(tx);
    const y0 = this.groundAt(...W(0, tF - 14)); // street level in front of the building
    const stone = tint(0.92, 0.9, 0.85), stoneD = tint(0.78, 0.76, 0.72), stoneI = inf(PBR.CONCRETE_PANEL, MODE.PLAIN), roofT = tint(0.5, 0.5, 0.48);
    const hallH = 17;
    const fn = [nx, 0, nz];
    // --- hall body (front wall omitted: the arcade facade below replaces it)
    const body = posRing([W(s1 - 2, tF), W(s1 - 2, tBack), W(s0 + 2, tBack), W(s0 + 2, tF)]);
    const sFront = body.findIndex((p) => Math.hypot(p[0] - W(s0 + 2, tF)[0], p[1] - W(s0 + 2, tF)[1]) < 0.01);
    const bodyOpen = body.slice(sFront).concat(body.slice(0, sFront)); // start at one front corner...
    const fc2 = W(s1 - 2, tF);
    if (Math.hypot(bodyOpen[1][0] - fc2[0], bodyOpen[1][1] - fc2[1]) < 0.01) bodyOpen.push(bodyOpen.shift()); // ...so the front edge is the open (last) one
    loft(B, [bodyOpen, bodyOpen], [y0 - 1, y0 + hallH], inf(PBR.CONCRETE_PANEL, MODE.WALL, FACADE.CLASSIC, -1, 0.53), stone, { bayW: 4.2, floorH: 5.6, closed: false });
    cap(B, body, y0 + hallH, inf(PBR.ROOF_TAR, MODE.PLAIN), roofT);
    this.col(body, y0 - 1, y0 + hallH);
    const bo = offsetRing(body, 0.7);
    loft(B, [bo, bo], [y0 + hallH - 1.2, y0 + hallH - 0.3], stoneI, stone);
    cap(B, bo, y0 + hallH - 0.3, stoneI, stone);
    cap(B, bo, y0 + hallH - 1.2, stoneI, stoneD, false);
    // nave clerestory with a gabled skylight along the axis
    const ta = tF + 10, tb2 = tBack - 8, tm = (ta + tb2) / 2;
    const nv = posRing([W(s0 + 14, ta), W(s1 - 14, ta), W(s1 - 14, tb2), W(s0 + 14, tb2)]);
    loft(B, [nv, nv], [y0 + hallH, y0 + hallH + 3.2], inf(PBR.CONCRETE_PANEL, MODE.WALL, FACADE.RIBBON, -1, 0.54), stone, { bayW: 3, floorH: 3.2 });
    const sky = inf(PBR.PLAIN, MODE.CURTAIN, 1, -1, 0.5), skyT = tint(0.62, 0.7, 0.74), yr = y0 + hallH + 3.2;
    for (const [tA, sg] of [[ta, 1], [tb2, -1]]) {
      const pts = [P3(s0 + 14, yr, tA), P3(s1 - 14, yr, tA), P3(s1 - 14, yr + 3, tm), P3(s0 + 14, yr + 3, tm)];
      const slope = Math.hypot(tm - tA, 3), nn = [fn[0] * sg * 3 / slope, Math.abs(tm - tA) / slope, fn[2] * sg * 3 / slope];
      B.q(pts, nn, sky, skyT, (p, i) => [(i === 1 || i === 2 ? s1 - s0 - 28 : 0) / 1.5, i >= 2 ? 2 : 0]);
    }
    for (const sv of [s0 + 14, s1 - 14]) {
      const sg = sv < 0 ? -1 : 1;
      B.poly([P3(sv, yr, ta), P3(sv, yr, tb2), P3(sv, yr + 3, tm)], [ux * sg, 0, uz * sg], stoneI, stone);
    }
    // --- front facade: arcade of round arches at street level, arched windows above
    const shaftHW = 6.8, bay = 7.4;
    const nB = Math.floor((s1 - s0 - 8) / bay), sStart = -(nB * bay) / 2;
    const covered = [[-shaftHW, shaftHW]];
    const rows = [{ yb: 0, yt: 8.4, wA: 4.6, hA: 7.4, lift: 0, depth: 2.6, open: true }, { yb: 8.4, yt: hallH - 1.2, wA: 3.2, hA: 5.2, lift: 0.9, depth: 0.45, open: false }];
    const panelI = inf(PBR.CONCRETE_PANEL, MODE.PLAIN, -1, -1, 0.53);
    for (let i = 0; i < nB; i++) {
      const sa = sStart + i * bay, sb = sa + bay, sc = (sa + sb) / 2;
      if (sa < shaftHW + 0.5 && sb > -shaftHW - 0.5) continue;
      covered.push([sa, sb]);
      for (const row of rows) {
        const hw = row.wA / 2, yb = row.yb + row.lift + (row.open ? 0.03 : 0), ys = yb + row.hA - hw;
        const o = [[sc - hw, yb], [sc + hw, yb]];
        for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI; o.push([sc + Math.cos(a) * hw, ys + Math.sin(a) * hw]); }
        // wall panel with the arch hole
        const outer = [[sa, row.yb], [sb, row.yb], [sb, row.yt], [sa, row.yt]];
        let tris = null;
        try { tris = THREE.ShapeUtils.triangulateShape(outer.map(([a, b]) => new THREE.Vector2(a, b)), [o.map(([a, b]) => new THREE.Vector2(a, b))]); } catch { tris = null; }
        if (tris && tris.length) {
          const all = outer.concat(o);
          const kk = all.map(([a, b]) => { const p = P3(a, y0 + b, tF); return B.v(p[0], p[1], p[2], fn[0], 0, fn[2], a / 3, b / 3, panelI, stone); });
          for (const f of tris) B.tri(kk[f[0]], kk[f[1]], kk[f[2]]);
        }
        // reveal around the opening
        for (let j = 0; j < o.length; j++) {
          const a = o[j], b = o[(j + 1) % o.length];
          if (row.open && j === 0) continue; // no sill: the arcade is open to the street
          const ds = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(ds, dy) || 1;
          let ins = -dy / L, iny = ds / L;
          if ((sc - (a[0] + b[0]) / 2) * ins + (ys - (a[1] + b[1]) / 2) * iny < 0) { ins = -ins; iny = -iny; }
          B.q([P3(a[0], y0 + a[1], tF), P3(b[0], y0 + b[1], tF), P3(b[0], y0 + b[1], tF + row.depth), P3(a[0], y0 + a[1], tF + row.depth)], [ux * ins, iny, uz * ins], stoneI, stoneD);
        }
        // back panel: shopfront (arcade) or arched window pane
        let bt = null;
        try { bt = THREE.ShapeUtils.triangulateShape(o.map(([a, b]) => new THREE.Vector2(a, b)), []); } catch { bt = null; }
        if (bt) {
          const gi = row.open ? inf(PBR.PLAIN, MODE.WALL, FACADE.STOREFRONT, -1, 0.55) : inf(PBR.PLAIN, MODE.PANE, FACADE.CLASSIC, -1, 0.56);
          const kk = o.map(([a, b]) => {
            const p = P3(a, y0 + b, tF + row.depth);
            const fu = row.open ? (a - (sc - hw)) / row.wA + i : 0.18 + 0.64 * (a - (sc - hw)) / row.wA + i;
            const fv = row.open ? 0.95 * (b - yb) / row.hA : 3 + 0.06 + 0.86 * (b - yb) / row.hA;
            return B.v(p[0], p[1], p[2], fn[0], 0, fn[2], fu, fv, gi, tint(0.3, 0.3, 0.3));
          });
          for (const f of bt) B.tri(kk[f[0]], kk[f[1]], kk[f[2]]);
        }
        if (!row.open) obox(B, ...W(sc, tF - 0.12), ux, uz, 0.32, 0.12, y0 + ys + hw - 0.25, y0 + ys + hw + 0.55, stoneI, stone);
      }
      // arcade ceiling over the open arches
      const yc = rows[0].yb + rows[0].hA + 0.03;
      B.q([P3(sa, y0 + yc, tF), P3(sb, y0 + yc, tF), P3(sb, y0 + yc, tF + 2.6), P3(sa, y0 + yc, tF + 2.6)], [0, -1, 0], stoneI, stoneD);
    }
    // plain wall pieces in the gaps (ends, beside the tower)
    covered.sort((a, b) => a[0] - b[0]);
    let cur = s0 + 2;
    const gaps = [];
    for (const [a, b] of covered) { if (a > cur + 0.05) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (s1 - 2 > cur + 0.05) gaps.push([cur, s1 - 2]);
    for (const [ga, gb] of gaps) {
      const r = posRing([W(ga, tF - 0.02), W(gb, tF - 0.02), W(gb, tF + 1.2), W(ga, tF + 1.2)]);
      loft(B, [r, r], [y0 - 1, y0 + hallH], inf(PBR.CONCRETE_PANEL, MODE.WALL, FACADE.CLASSIC, -1, 0.57), stone, { bayW: 4, floorH: 5.6 });
    }
    // --- clock tower: shaft, clock stage with four 6.7 m dials, belvedere, lantern, dome
    const tw = (h) => roundedSquare(tx, tz, Math.atan2(uz, ux), h, 0.3, 1);
    const clockHW = 6.1, belHW = 4.9;
    loft(B, [tw(shaftHW), tw(shaftHW)], [y0 - 1, y0 + 44], inf(PBR.CONCRETE_PANEL, MODE.WALL, FACADE.SMALL, -1, 0.58), stone, { bayW: 4.5, floorH: 6.4 });
    for (const sgS of [-1, 1]) for (const sgT of [-1, 1]) {
      const d = shaftHW - 0.55;
      obox(B, tx + ux * sgS * d - nx * sgT * d, tz + uz * sgS * d - nz * sgT * d, ux, uz, 0.85, 0.85, y0 + hallH, y0 + 44, stoneI, stone, { top: false });
    }
    const corn = (hw, y, hgt) => { const r = tw(hw); loft(B, [r, r], [y, y + hgt], stoneI, stone); cap(B, r, y + hgt, stoneI, stone); cap(B, r, y, stoneI, stoneD, false); };
    corn(shaftHW + 0.9, y0 + 44, 1.3);
    loft(B, [tw(clockHW), tw(clockHW)], [y0 + 45.3, y0 + 56], stoneI, stone);
    const dialR = 3.35, dyc = y0 + 50.6;
    for (let k = 0; k < 4; k++) {
      const a = Math.atan2(uz, ux) + (k * Math.PI) / 2;
      const ox = Math.cos(a - Math.PI / 2), oz = Math.sin(a - Math.PI / 2); // dial normal
      const rx = -oz, rz = ox; // viewer's right when looking at the dial from outside
      const c = [tx + ox * (clockHW + 0.06), tz + oz * (clockHW + 0.06)];
      const P = (u, v) => [c[0] + rx * (u - 0.5) * 2 * dialR, dyc + (v - 0.5) * 2 * dialR, c[1] + rz * (u - 0.5) * 2 * dialR];
      B.q([P(0, 0), P(1, 0), P(1, 1), P(0, 1)], [ox, 0, oz], [-1, -1, 0.5, enc(PBR.CONCRETE_PANEL, MODE.CLOCK)], stone, (p, i) => [i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0]);
    }
    corn(clockHW + 0.6, y0 + 56, 1.0);
    loft(B, [tw(belHW - 1.7), tw(belHW - 1.7)], [y0 + 57, y0 + 63.5], inf(PBR.PLAIN, MODE.PLAIN), tint(0.14, 0.13, 0.12));
    for (const sgS of [-1, 1]) for (const sgT of [-1, 1]) {
      const d = belHW - 0.5;
      obox(B, tx + ux * sgS * d - nx * sgT * d, tz + uz * sgS * d - nz * sgT * d, ux, uz, 0.55, 0.55, y0 + 57, y0 + 63.5, stoneI, stone, { top: false });
    }
    for (let k = 0; k < 4; k++) { // arches between the belvedere piers
      const a = Math.atan2(uz, ux) + (k * Math.PI) / 2, ox = Math.cos(a - Math.PI / 2), oz = Math.sin(a - Math.PI / 2);
      obox(B, tx + ox * (belHW - 0.4), tz + oz * (belHW - 0.4), -oz, ox, belHW - 1.0, 0.35, y0 + 62.2, y0 + 63.5, stoneI, stone, { bottom: true });
    }
    corn(belHW + 0.35, y0 + 63.5, 0.9);
    const oct = (r) => { const pts = []; for (let i = 0; i < 8; i++) { const a = Math.atan2(uz, ux) + (i + 0.5) * Math.PI / 4; pts.push([tx + Math.cos(a) * r, tz + Math.sin(a) * r]); } return posRing(pts); };
    loft(B, [oct(3.2), oct(3.2)], [y0 + 64.4, y0 + 68.5], inf(PBR.CONCRETE_PANEL, MODE.WALL, FACADE.VICTORIAN, -1, 0.59), stone, { bayW: 1.25, floorH: 4.1 });
    const dome = [[3.45, 68.5], [3.3, 69.7], [2.9, 70.9], [2.2, 71.9], [1.2, 72.6], [0.12, 73.0]];
    loft(B, dome.map(([r]) => oct(r)), dome.map(([, y]) => y0 + y), inf(PBR.METAL, MODE.PLAIN), tint(0.45, 0.52, 0.46));
    obox(B, tx, tz, ux, uz, 0.12, 0.12, y0 + 73, y0 + 75.5, inf(PBR.METAL, MODE.PLAIN), tint(0.8, 0.72, 0.45));
    this.col(tw(shaftHW), y0 - 1, y0 + 57);
    this.col(tw(belHW), y0 + 57, y0 + 75);
    this.stats.ferryBase = +y0.toFixed(1);
  }

  // ================================================================ Embarcadero Center 1-4 (stepped slab towers, outline lights)
  embarcadero(w, key) {
    const parts = w.parts.filter((b) => sanitizeRing(b.p)).sort((a, b) => (a.h || 0) - (b.h || 0));
    if (!parts.length) return;
    const base = this.baseOf(w.pts);
    const B = this.bufAt(w.cx);
    const conc = tint(0.95, 0.93, 0.88);
    const lights = [0, -1, 0.5, enc(PBR.PLAIN, MODE.LED)], lt = tint(0.9, 0.9, 0.86);
    for (const b of parts) {
      const r = posRing(sanitizeRing(b.p));
      const h = b.h;
      loft(B, [r, r], [base - 1, base + h], inf(PBR.CONCRETE_PANEL, MODE.WALL, FACADE.VERTICAL, h > 40 ? FACADE.STOREFRONT : -1, 0.3 + (key.charCodeAt(2) % 5) * 0.1), conc, { bayW: 1.9, floorH: 3.75 });
      cap(B, r, base + h, inf(PBR.ROOF_TAR, MODE.PLAIN), tint(0.6, 0.6, 0.6));
      this.col(r, base - 1, base + h);
      // outline lights: vertical corner strips + roof edge strips
      const o = offsetRing(r, 0.12);
      for (let i = 0; i < o.length; i++) {
        const p = o[i], q = r[i];
        const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1;
        const n = [dx / l, 0, dz / l], s = [-n[2], 0, n[0]];
        const y1 = base + 12, y2 = base + h;
        B.q([[p[0] - s[0] * 0.18, y1, p[1] - s[2] * 0.18], [p[0] + s[0] * 0.18, y1, p[1] + s[2] * 0.18], [p[0] + s[0] * 0.18, y2, p[1] + s[2] * 0.18], [p[0] - s[0] * 0.18, y2, p[1] - s[2] * 0.18]], n, lights, lt,
          (pp, k) => [(pp[1] - base) * 1.0, k === 1 || k === 2 ? 1 : 0]);
      }
      for (let i = 0; i < o.length; i++) {
        const a = o[i], c = o[(i + 1) % o.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 0.5) continue;
        const n = [(c[1] - a[1]) / L, 0, -(c[0] - a[0]) / L];
        B.q([[a[0], base + h - 0.35, a[1]], [c[0], base + h - 0.35, c[1]], [c[0], base + h + 0.05, c[1]], [a[0], base + h + 0.05, a[1]]], n, lights, lt, (pp, k) => [k === 1 || k === 2 ? L : 0, k >= 2 ? 1 : 0]);
      }
    }
  }

  // ================================================================ Millennium Tower (197 m, blue glass, stepped crown)
  millennium(w) {
    const b = w.parts.sort((x, y) => (y.h || 0) - (x.h || 0))[0];
    let r = b && sanitizeRing(b.p) ? posRing(sanitizeRing(b.p)) : roundedSquare(w.cx, w.cz, 0.78, 20, 8, 3);
    const base = this.baseOf(r), H = b ? b.h : 197;
    const B = this.bufAt(w.cx);
    const g = inf(PBR.PLAIN, MODE.CURTAIN, 0, -1, 0.66), gt = tint(0.5, 0.66, 0.8);
    const steps = [[0, 0], [H - 26, 0], [H - 26, 2.4], [H - 16, 2.4], [H - 16, 5.2], [H - 7, 5.2], [H - 7, 8.4], [H, 8.4]];
    let prevY = base - 1, prevRing = r;
    for (let k = 1; k < steps.length; k++) {
      const [y, d] = steps[k];
      const ring = d > 0 ? insetRing(r, d) || prevRing : r;
      if (steps[k - 1][0] === y) { // terrace: flat ring between the two outlines
        cap(B, prevRing, base + y, inf(PBR.CONCRETE_PANEL, MODE.PLAIN), tint(0.75, 0.75, 0.74));
        prevRing = ring; continue;
      }
      loft(B, [ring, ring], [prevY, base + y], g, gt, { bayW: 1.5, floorH: 3.4 });
      this.col(ring, prevY, base + y);
      prevY = base + y; prevRing = ring;
    }
    cap(B, prevRing, base + H, inf(PBR.ROOF_TAR, MODE.PLAIN), tint(0.5, 0.5, 0.5));
    // slim crown fins
    const top = insetRing(r, 8.4) || r;
    const c = centroid(top);
    obox(B, c[0], c[1], 1, 0, 3, 3, base + H, base + H + 6, inf(PBR.METAL, MODE.PLAIN), tint(0.7, 0.72, 0.74));
  }

  // ================================================================ 181 Fremont (244 m, diagonal mega-bracing, sloped crown + spire)
  fremont181(w) {
    const b = w.parts[0];
    let r = b && sanitizeRing(b.p) ? posRing(sanitizeRing(b.p)) : roundedSquare(w.cx, w.cz, 0.78, 16, 1, 1);
    const base = this.baseOf(r);
    const B = this.bufAt(w.cx);
    const roofY = 212, H = 245;
    const g = inf(PBR.PLAIN, MODE.CURTAIN, 3, -1, 0.77), gt = tint(0.66, 0.74, 0.8);
    loft(B, [r, r], [base - 1, base + roofY], g, gt, { bayW: 1.5, floorH: 3.9 });
    this.col(r, base - 1, base + roofY);
    // sloped crown: shrink to a narrow ridge
    const c = centroid(r);
    const top = r.map(([x, z]) => [c[0] + (x - c[0]) * 0.35, c[1] + (z - c[1]) * 0.35]);
    loft(B, [r, top], [base + roofY, base + roofY + 18], inf(PBR.PLAIN, MODE.CURTAIN, 1, -1, 0.78), tint(0.72, 0.78, 0.82), { bayW: 1.5, floorH: 3.9 });
    cap(B, top, base + roofY + 18, inf(PBR.METAL, MODE.PLAIN), tint(0.75, 0.76, 0.78));
    obox(B, c[0], c[1], 1, 0, 0.5, 0.5, base + roofY + 18, base + H, inf(PBR.METAL, MODE.PLAIN), tint(0.85, 0.86, 0.88));
    obox(B, c[0], c[1], 1, 0, 0.4, 0.4, base + H, base + H + 0.5, [2, -1, 0.6, enc(PBR.PLAIN, MODE.LED)], tint(1, 0.2, 0.1));
    // exterior diagonal bracing (white steel) on every long face, 48 m modules
    const steel = inf(PBR.PLAIN, MODE.PLAIN), st = tint(0.9, 0.91, 0.92);
    for (let i = 0; i < r.length; i++) {
      const a = r[i], e = r[(i + 1) % r.length], L = Math.hypot(e[0] - a[0], e[1] - a[1]);
      if (L < 12) continue;
      const n = [(e[1] - a[1]) / L, 0, -(e[0] - a[0]) / L];
      const P = (t, y) => [a[0] + (e[0] - a[0]) * t, base + y, a[1] + (e[1] - a[1]) * t];
      for (let y = 8; y + 48 <= roofY + 1; y += 48) {
        beam(B, P(0.04, y), P(0.5, y + 48), n, 1.3, 0.55, steel, st);
        beam(B, P(0.96, y), P(0.5, y + 48), n, 1.3, 0.55, steel, st);
        beam(B, P(0.02, y), P(0.98, y), n, 0.9, 0.4, steel, st);
      }
    }
  }

  // ================================================================ Coit Tower (Telegraph Hill, 64 m fluted column)
  coit() {
    const [bx, bz] = bakeXZ(...COIT.ll);
    const cx = bx - this.off.x, cz = bz - this.off.z;
    const ground = this.groundAt(cx, cz);
    const B = this.bufAt(cx);
    const conc = tint(0.93, 0.9, 0.84), ci = inf(PBR.CONCRETE_ROUGH, MODE.PLAIN);
    // lobby building (murals), with a crenellated parapet
    const lob = roundedSquare(cx, cz + 6, 0, 13, 0.2, 1);
    loft(B, [lob, lob], [ground - 2, ground + 7.5], inf(PBR.CONCRETE_ROUGH, MODE.WALL, FACADE.SMALL, -1, 0.81), conc, { bayW: 4.3, floorH: 7.5 });
    cap(B, lob, ground + 7.5, inf(PBR.ROOF_TAR, MODE.PLAIN), tint(0.6, 0.6, 0.58));
    this.col(lob, ground - 2, ground + 7.5);
    // fluted shaft: 24 flutes, radius 5.6 m, slight taper
    const flutes = 24, seg = flutes * 2;
    const ringAt = (R) => { const pts = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; const rr = R * (i % 2 ? 0.955 : 1); pts.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr]); } return posRing(pts); };
    const ys = [ground + 7.5, ground + 54], Rs = [5.75, 5.45];
    loft(B, [ringAt(Rs[0]), ringAt(Rs[1])], ys, inf(PBR.CONCRETE_ROUGH, MODE.WALLONLY), conc);
    // observation level: tall arched openings between piers (dark recesses), then the crown
    const obs = [ground + 54, ground + 60.5];
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = a0 + Math.PI / 4;
      const pier = (a) => [cx + Math.cos(a) * 5.5, cz + Math.sin(a) * 5.5];
      const p0 = pier(a0 + 0.08), p1 = pier(a1 - 0.08);
      const n = [Math.cos(a0 + Math.PI / 8), 0, Math.sin(a0 + Math.PI / 8)];
      B.q([[p0[0] - n[0] * 0.6, obs[0], p0[1] - n[2] * 0.6], [p1[0] - n[0] * 0.6, obs[0], p1[1] - n[2] * 0.6], [p1[0] - n[0] * 0.6, obs[1] - 1.2, p1[1] - n[2] * 0.6], [p0[0] - n[0] * 0.6, obs[1] - 1.2, p0[1] - n[2] * 0.6]],
        n, inf(PBR.PLAIN, MODE.PANE, FACADE.CLASSIC, -1, 0.82), tint(0.3, 0.3, 0.3), (p, k) => [i * 2 + (k === 1 || k === 2 ? 0.82 : 0.18), 20 + (k >= 2 ? 0.92 : 0.06)]);
      const pc = pier(a0);
      obox(B, pc[0], pc[1], -Math.sin(a0), Math.cos(a0), 0.45, 0.55, obs[0], obs[1], ci, conc, { top: false });
    }
    const crownR = ringAt(5.9);
    loft(B, [crownR, crownR], [obs[1] - 1.2, ground + 64], ci, conc);
    cap(B, ringAt(5.9), ground + 64, ci, conc);
    cap(B, ringAt(5.5), obs[0], ci, conc, false);
    this.col(ringAt(5.8), ground + 7.5, ground + 64);
    this.stats.coitGround = +ground.toFixed(1);
  }

  update(dt, cameraPos, darkness) {
    this.time += dt || 0;
    const u = this.mat && this.mat.facade && this.mat.facade.userData.uniforms;
    if (u) {
      u.uTime.value = this.time;
      const h = this.world && this.world.timeOfDay;
      if (Number.isFinite(h)) u.uClock.value = h;
    }
    void cameraPos; void darkness; void clamp;
  }
}

/**
 * MapWorld plugin (engine/src/world/MapWorld.js): claims the OSM footprints before the generic building pass,
 * builds the landmarks on the merged buildings (world.landmarks = the Landmarks instance) and keeps the filler lots
 * off Coit Tower's hill.
 */
export function landmarksPlugin() {
  return {
    name: 'landmarks', label: 'Landmarks', instance: null,
    clearZones: () => landmarkClearZones(),
    beforeBuildings(ctx) { claimLandmarks(ctx.data, ctx.offset); },
    afterBuildings(ctx) { this.instance = new Landmarks(ctx); return this.instance.build(); },
    update(dt, cameraPos, darkness) { this.instance.update(dt, cameraPos, darkness); },
  };
}

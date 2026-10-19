// Hero-car body surface: Tesla Roadster (2nd gen) proportions — 4.6 m long, 2.0 m wide,
// 1.13 m tall, 2.8 m wheelbase. The skin is lofted from smooth cross-sections (centripetal
// Catmull-Rom through feature points) sampled at stations along Z, with real wheel-arch
// openings, an open cockpit under a glass canopy, and rounded/dished nose and tail caps.
//
// Local frame: forward -Z, right +X, up +Y; tyre contact patch at y = 0.
// Pure geometry (THREE math only) so it runs in Node as well.
import * as THREE from 'three';
import { SPEC } from './Physics.js';

export const WR = SPEC.wheelRadius;              // 0.35
export const ZF = SPEC.axleFront, ZR = SPEC.axleRear; // -1.45 / 1.35 (2.8 m wheelbase)
export const NOSE_R = 0.11, TAIL_R = 0.075;       // end-fillet radii
export const Z0 = -SPEC.length / 2 + NOSE_R;      // first lofted station (-2.19)
export const Z1 = SPEC.length / 2 - TAIL_R;       // last lofted station (2.225)
export const ARCH_R = 0.405;                      // wheel-arch opening radius (tyre 0.35)
export const RIM_IN = 0.25;                       // cockpit rim inset from the body side
export const ZC0 = -0.71;                         // windscreen base (cowl)
export const ZBULK = 0.76;                        // rear bulkhead (end of the open cockpit)
export const ZC1 = 1.2;                           // end of the glass canopy (fastback)
const AXLES = [ZF, ZR];

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const sstep = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// 1D monotone cubic (Fritsch-Carlson Hermite) through keys [[z, v], ...]: smooth, no overshoot,
// zero slope at local extrema (so a key placed at a crown is the crown).
export function curve(keys) {
  const n = keys.length;
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const h0 = keys[i][0] - keys[i - 1][0], h1 = keys[i + 1][0] - keys[i][0];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);   // weighted harmonic mean
  }
  return (s) => {
    if (s <= keys[0][0]) return keys[0][1];
    if (s >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (i < n - 2 && s > keys[i + 1][0]) i++;
    const h = keys[i + 1][0] - keys[i][0], t = (s - keys[i][0]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * keys[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * keys[i + 1][1] + (t3 - t2) * h * m[i + 1];
  };
}

// ---- profiles keyed by z (metres) -------------------------------------------------------
export const HW = curve([[-2.19, 0.62], [-2.1, 0.76], [-1.95, 0.87], [-1.75, 0.93], [-1.45, 0.962], [-1.15, 0.956],
  [-0.8, 0.936], [-0.35, 0.922], [0.1, 0.93], [0.55, 0.965], [0.95, 0.99], [1.35, 1.0], [1.75, 0.99], [2.0, 0.965],
  [2.15, 0.928], [2.225, 0.895]]);
export const YB = curve([[-2.19, 0.22], [-2.0, 0.165], [-1.75, 0.137], [1.75, 0.137], [2.0, 0.19], [2.225, 0.3]]);
export const BELT = curve([[-2.19, 0.47], [-2.0, 0.6], [-1.75, 0.72], [-1.45, 0.785], [-1.15, 0.765], [-0.85, 0.72],
  [-0.4, 0.722], [0.1, 0.752], [0.6, 0.8], [1.0, 0.838], [1.35, 0.858], [1.8, 0.862], [2.1, 0.848], [2.225, 0.83]]);
export const FT = curve([[-2.19, 0.49], [-2.0, 0.64], [-1.75, 0.775], [-1.45, 0.835], [-1.15, 0.818], [-0.85, 0.785],
  [-0.4, 0.788], [0.1, 0.812], [0.6, 0.858], [1.0, 0.905], [1.35, 0.938], [1.8, 0.93], [2.1, 0.9], [2.225, 0.866]]);
export const TC = curve([[-2.19, 0.47], [-2.0, 0.555], [-1.7, 0.625], [-1.3, 0.675], [-0.9, 0.735], [-0.71, 0.775],
  [0, 0.84], [0.9, 0.885], [1.35, 0.905], [1.8, 0.905], [2.1, 0.89], [2.225, 0.866]]);
// absolute roof line of the glass canopy
export const ROOF = curve([[-0.71, 0.775], [-0.55, 0.858], [-0.35, 0.962], [-0.15, 1.05], [0.0, 1.1], [0.16, 1.13],
  [0.36, 1.126], [0.56, 1.092], [0.76, 1.035], [0.96, 0.962], [1.2, 0.898]]);

export function archY(z) {
  let y = -Infinity;
  for (const za of AXLES) {
    const dz = z - za;
    if (Math.abs(dz) < ARCH_R) y = Math.max(y, WR + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  return y;
}
function archInf(z) {
  let a = 0;
  for (const za of AXLES) { const d = Math.abs(z - za) / 0.8; if (d < 1) a = Math.max(a, 0.5 + 0.5 * Math.cos(Math.PI * d)); }
  return a;
}
// sculpted scallop along the lower door, rising toward the rear haunch
export function dentCentre(z) { return 0.36 + 0.15 * clamp((z + 1.0) / 1.9, 0, 1); }
function dent(z, y) {
  const D = 0.028 * sstep((z + 1.0) / 0.6) * (1 - sstep((z - 0.78) / 0.22));
  if (D <= 0) return 0;
  const w = 0.075, u = (y - dentCentre(z)) / w;
  return D * Math.exp(-u * u);
}
// undercut: the lower tail leans forward, the lower nose recedes
export function shear(z, y, b, f) {
  const low = Math.pow(1 - clamp((y - b) / (f - b), 0, 1), 1.6);
  return -0.1 * low * sstep((z - 1.85) / 0.38) + 0.06 * low * sstep((-1.9 - z) / 0.29);
}

// ---- cross-sections ----------------------------------------------------------------------
export const N_LO = 14, N_UP = 7, N_B = 9, N_UNDER = 5;
export const RING = N_LO + N_UP - 1 + N_B - 1;   // 28 points rocker -> top centre
export const I_CREASE = N_LO - 1;                // 13
export const I_RIM = N_LO + N_UP - 2;            // 19
const CURV_K = 0.035;
const _v = new THREE.Vector3();

function sampleRange(cr, ta, tb, n, X, Y, off) {
  const M = 48;
  const xs = new Float64Array(M + 1), ys = new Float64Array(M + 1), cum = new Float64Array(M + 1);
  for (let i = 0; i <= M; i++) { cr.getPoint(ta + (tb - ta) * (i / M), _v); xs[i] = _v.x; ys[i] = _v.y; }
  for (let i = 1; i <= M; i++) {
    const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1];
    let ang = 0;
    if (i > 1) { const px = xs[i - 1] - xs[i - 2], py = ys[i - 1] - ys[i - 2]; ang = Math.abs(Math.atan2(px * dy - py * dx, px * dx + py * dy)); }
    cum[i] = cum[i - 1] + Math.hypot(dx, dy) + CURV_K * ang;
  }
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (cum[M] * k) / (n - 1);
    while (j < M - 1 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j], f = seg > 1e-12 ? clamp((target - cum[j]) / seg, 0, 1) : 0;
    X[off + k] = xs[j] + (xs[j + 1] - xs[j]) * f;
    Y[off + k] = ys[j] + (ys[j + 1] - ys[j]) * f;
  }
}

const _secCache = new Map();
/** Right-half cross-section at z: ring X/Y (rocker -> top centre), under-floor points, profile values. */
export function section(z) {
  const key = Math.round(z * 1e5);
  const hit = _secCache.get(key);
  if (hit) return hit;
  const w = HW(z), b = YB(z), bl = BELT(z), f = FT(z), t = TC(z);
  const ai = archInf(z);
  const ym = b + (0.4 + 0.24 * ai) * (bl - b);
  const xc = w - 0.13, xr = w - RIM_IN;
  const topY = (x) => t + (f - t) * sstep(x / xc);
  const P = [[w - 0.085, b], [w - 0.03, b + 0.028], [w - 0.006, b + 0.11], [w, ym],
    [w - 0.016, bl - 0.045], [w - 0.042, bl + 0.004], [xc, f],
    [xr, topY(xr)], [xr * 0.5, topY(xr * 0.5)], [0, t], [-xr * 0.5, topY(xr * 0.5)]];
  const cr = new THREE.CatmullRomCurve3(P.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  const tAt = (i) => i / (P.length - 1);
  const ya = archY(z);
  const arch = ya > b + 1e-4;
  let tStart = 0;
  if (arch) {
    let lo = 0, hi = tAt(5);
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; cr.getPoint(m, _v); if (_v.y < ya) lo = m; else hi = m; }
    tStart = (lo + hi) / 2;
  }
  const X = new Float64Array(RING), Y = new Float64Array(RING);
  sampleRange(cr, tStart, tAt(5), N_LO, X, Y, 0);
  sampleRange(cr, tAt(5), tAt(7), N_UP, X, Y, N_LO - 1);
  sampleRange(cr, tAt(7), tAt(9), N_B, X, Y, I_RIM);
  for (let k = 0; k < N_LO - 1; k++) X[k] -= dent(z, Y[k]);
  X[RING - 1] = 0; Y[RING - 1] = t;
  const xEdge = arch ? w - (z < 0 ? 0.46 : 0.36) : X[0];
  const UX = new Float64Array(N_UNDER), UY = new Float64Array(N_UNDER);
  for (let k = 0; k < N_UNDER; k++) { UX[k] = (xEdge * k) / (N_UNDER - 1); UY[k] = b; }
  if (!arch) { UX[N_UNDER - 1] = X[0]; UY[N_UNDER - 1] = Y[0]; }
  // arc length along the ring (uv)
  const V = new Float64Array(RING);
  for (let k = 1; k < RING; k++) V[k] = V[k - 1] + Math.hypot(X[k] - X[k - 1], Y[k] - Y[k - 1]);
  const s = { z, X, Y, UX, UY, V, w, b, bl, f, t, xc, xr, yr: topY(xr), topY, arch, ya, xEdge };
  _secCache.set(key, s);
  return s;
}

// ---- stations ----------------------------------------------------------------------------
export function bodyStations() {
  const s = [];
  const inArch = (z) => AXLES.some((za) => Math.abs(z - za) <= ARCH_R + 0.012);
  for (let z = Z0; z < Z1 - 0.02; z += 0.048) if (!inArch(z)) s.push(z);
  s.push(Z1, Z0 + 0.02, Z1 - 0.02);
  for (const za of AXLES) {
    const n = 26;
    for (let k = 0; k <= n; k++) s.push(za + ARCH_R * 0.9995 * Math.sin(-Math.PI / 2 + (Math.PI * k) / n));
    s.push(za - ARCH_R - 0.006, za + ARCH_R + 0.006);
  }
  s.push(ZC0, ZBULK, ZC1);
  s.sort((a, b) => a - b);
  const out = [];
  for (const z of s) if (!out.length || z - out[out.length - 1] > 0.003) out.push(z);
  return out;
}

// ---- rows (station rings + rounded end treatments) ---------------------------------------
function stationRow(z) {
  const sec = section(z);
  const P = new Float32Array(RING * 3), U = new Float32Array(N_UNDER * 3);
  for (let k = 0; k < RING; k++) { P[k * 3] = sec.X[k]; P[k * 3 + 1] = sec.Y[k]; P[k * 3 + 2] = z + shear(z, sec.Y[k], sec.b, sec.f); }
  for (let k = 0; k < N_UNDER; k++) { U[k * 3] = sec.UX[k]; U[k * 3 + 1] = sec.UY[k]; U[k * 3 + 2] = z + shear(z, sec.UY[k], sec.b, sec.f); }
  return { z, P, U, V: sec.V, kind: 'main', arch: sec.arch };
}

function endRows(base, sec, dir) {
  const r = dir < 0 ? NOSE_R : TAIL_R;
  const NF = 6, ND = dir < 0 ? 3 : 4;
  const conc = dir < 0 ? 0 : 0.05;        // nose flat-closed, tail dished
  const yc = (sec.b + sec.f) / 2, hh = (sec.f - sec.b) / 2, sx = Math.max(0, sec.w - hh);
  const xf = (src, n, k, dst) => {
    for (let i = 0; i < n; i++) {
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
      const cx = clamp(x, -sx, sx), dx = x - cx, dy = y - yc, d = Math.hypot(dx, dy) || 1e-6;
      const im = Math.min(r, 0.8 * d);
      let inset, dz;
      if (k <= NF) { const a = (k / NF) * (Math.PI / 2); inset = im * (1 - Math.cos(a)); dz = r * Math.sin(a); } else {
        const f = (k - NF) / ND;
        inset = im + (d - im) * f;
        dz = r - conc * Math.sin(f * Math.PI / 2);
      }
      const q = 1 - inset / d;
      dst[i * 3] = cx + dx * q; dst[i * 3 + 1] = yc + dy * q; dst[i * 3 + 2] = z + dir * dz;
    }
  };
  const rows = [];
  for (let k = 1; k <= NF + ND; k++) {
    const P = new Float32Array(RING * 3), U = new Float32Array(N_UNDER * 3);
    xf(base.P, RING, k, P); xf(base.U, N_UNDER, k, U);
    rows.push({ z: base.z, P, U, V: base.V, kind: dir < 0 ? 'nose' : 'tail' });
  }
  return rows;
}

export function bodyRows() {
  const st = bodyStations();
  const main = st.map(stationRow);
  const nose = endRows(main[0], section(st[0]), -1).reverse();
  const tail = endRows(main[main.length - 1], section(st[st.length - 1]), 1);
  return [...nose, ...main, ...tail];
}

// ---- generic mirrored loft ------------------------------------------------------------------
/**
 * rows: [{P: Float32Array(count*3), V?}], groupOf(r, k) -> group index or -1 (skip).
 * Builds both sides (x mirrored). uv = (z, ring arc length) or custom uvOf.
 */
export function loftMirrored(rows, key, count, groupOf, nGroups = 1, uvOf = null, skipNormalRow = null) {
  const nR = rows.length;
  const pos = new Float32Array(nR * count * 3 * 2), uv = new Float32Array(nR * count * 2 * 2);
  const groups = Array.from({ length: nGroups }, () => []);
  for (let side = 0; side < 2; side++) {
    const sg = side === 0 ? 1 : -1, base = side * nR * count;
    for (let r = 0; r < nR; r++) {
      const A = rows[r][key];
      for (let k = 0; k < count; k++) {
        const vi = base + r * count + k;
        pos[vi * 3] = sg * A[k * 3]; pos[vi * 3 + 1] = A[k * 3 + 1]; pos[vi * 3 + 2] = A[k * 3 + 2];
        if (uvOf) { const [u, v] = uvOf(rows[r], k, A); uv[vi * 2] = u; uv[vi * 2 + 1] = v; } else {
          uv[vi * 2] = A[k * 3 + 2]; uv[vi * 2 + 1] = rows[r].V ? rows[r].V[k] : A[k * 3];
        }
      }
    }
    for (let r = 0; r < nR - 1; r++) for (let k = 0; k < count - 1; k++) {
      const g = groupOf ? groupOf(r, k) : 0;
      if (g < 0) continue;
      const a = base + r * count + k, b = a + 1, c = a + count, d = c + 1;
      if (sg > 0) groups[g].push(a, b, c, b, d, c); else groups[g].push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx = [];
  let start = 0;
  groups.forEach((g, i) => { for (const v of g) idx.push(v); geo.addGroup(start, g.length, i); start += g.length; });
  if (skipNormalRow) {
    // normals from the regular grid only: rows across a topology jump (arch edges) would skew them
    const nIdx = [];
    for (let side = 0; side < 2; side++) {
      const base = side * nR * count;
      for (let r = 0; r < nR - 1; r++) {
        if (skipNormalRow(r)) continue;
        for (let k = 0; k < count - 1; k++) {
          const a = base + r * count + k, b = a + 1, c = a + count, d = c + 1;
          if (side === 0) nIdx.push(a, b, c, b, d, c); else nIdx.push(a, c, b, b, c, d);
        }
      }
    }
    geo.setIndex(nIdx);
    geo.computeVertexNormals();
  }
  geo.setIndex(idx);
  if (!skipNormalRow) geo.computeVertexNormals();
  return geo;
}

// flip winding if the average face normal disagrees with the expected direction function
export function orient(g, expect) {
  const p = g.attributes.position, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), ctr = new THREE.Vector3(), e = new THREE.Vector3(), t = new THREE.Vector3();
  let score = 0;
  for (let i = 0; i < ix.length; i += 3) {
    a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
    n.subVectors(b, a).cross(t.subVectors(c, a));
    ctr.copy(a).add(b).add(c).divideScalar(3);
    expect(ctr, e);
    score += n.dot(e);
  }
  if (score < 0) {
    for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; }
    g.index.needsUpdate = true;
    const nn = g.attributes.normal;
    if (nn) { for (let i = 0; i < nn.array.length; i++) nn.array[i] = -nn.array[i]; nn.needsUpdate = true; } else g.computeVertexNormals();
  }
  return g;
}

// ---- the skin ---------------------------------------------------------------------------------
/** { paint (groups: 0 paint, 1 rear shelf), under (carbon floor), wellTop, wellWall, wellEnds, rows } */
export function buildBodyGeometry() {
  const rows = bodyRows();
  const inC = (row) => row.kind === 'main' && row.z >= ZC0 - 1e-6 && row.z <= ZBULK + 1e-6;
  const inS = (row) => row.kind === 'main' && row.z >= ZBULK - 1e-6 && row.z <= ZC1 + 1e-6;
  const jump = (r) => rows[r].kind === 'main' && rows[r + 1].kind === 'main' && rows[r].arch !== rows[r + 1].arch;
  const paint = loftMirrored(rows, 'P', RING, (r, k) => {
    if (k < I_RIM) return 0;
    if (inC(rows[r]) && inC(rows[r + 1])) return -1;     // open cockpit under the canopy
    if (inS(rows[r]) && inS(rows[r + 1])) return 1;      // shelf under the rear glass
    return 0;
  }, 2, null, jump);
  orient(paint, (c, e) => e.set(c.x, c.y - 0.45, c.z * 0.15));
  // floor; its share of the rounded nose/tail caps is the black lower fascia (group 1)
  const under = loftMirrored(rows, 'U', N_UNDER, (r) => (rows[r].kind !== 'main' || rows[r + 1].kind !== 'main' ? 1 : 0), 2,
    (row, k, A) => [A[k * 3 + 2], A[k * 3]], jump);
  orient(under, (_c, e) => e.set(0, -1, 0));

  // wheel wells: liner top at the arch height, inner wall, closed ends
  const wellTopRows = [], wellWallRows = [], ends = [];
  const st = bodyStations();
  for (const za of AXLES) {
    const zs = st.filter((z) => Math.abs(z - za) < ARCH_R && section(z).arch);
    const wr = [], ww = [];
    for (const z of zs) {
      const s = section(z);
      wr.push({ P: new Float32Array([s.X[0], s.Y[0], z, s.X[0] - 0.02, s.Y[0] + 0.004, z, s.xEdge, s.Y[0] + 0.004, z]) });
      ww.push({ P: new Float32Array([s.xEdge, s.Y[0] + 0.004, z, s.xEdge, s.b, z]) });
    }
    wellTopRows.push(wr); wellWallRows.push(ww);
    for (const z of [zs[0], zs[zs.length - 1]]) {
      const s = section(z);
      ends.push({ z, x0: s.xEdge, x1: s.w - 0.004, y0: s.b - 0.002, y1: s.Y[0] + 0.006, facing: z < za ? 1 : -1 });
    }
  }
  const tops = wellTopRows.map((r) => orient(loftMirrored(r, 'P', 3, null, 1, (_row, k, A) => [A[k * 3 + 2], A[k * 3]]), (_c, e) => e.set(0, -1, 0)));
  const walls = wellWallRows.map((r) => orient(loftMirrored(r, 'P', 2, null, 1, (_row, k, A) => [A[k * 3 + 2], A[k * 3 + 1]]), (c, e) => e.set(Math.sign(c.x), 0, 0)));
  const endPos = [];
  for (const e of ends) for (const sg of [1, -1]) {
    const q = [[e.x0, e.y0], [e.x1, e.y0], [e.x1, e.y1], [e.x0, e.y1]].map(([x, y]) => [sg * x, y, e.z]);
    // corners are CCW seen from +z for sg = +1 (normal +z); flip so the wall faces the wheel
    if (sg * e.facing > 0) endPos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
    else endPos.push(...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]);
  }
  const wellEnds = new THREE.BufferGeometry();
  wellEnds.setAttribute('position', new THREE.Float32BufferAttribute(endPos, 3));
  wellEnds.computeVertexNormals();
  return { paint, under, wellTops: tops, wellWalls: walls, wellEnds, rows };
}

// ---- surface queries on the lofted skin (mid-body; for seams, handles, mirrors) --------------
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _tr = new THREE.Vector3(), _tz = new THREE.Vector3();
/** Point + outward normal at station z, fractional ring index u (0 rocker .. RING-1 top centre). */
export function bodyPoint(z, u, side, outP, outN) {
  const s0 = section(z), s1 = section(z + 0.004);
  const i = clamp(Math.floor(u), 0, RING - 2), f = u - i;
  const x = s0.X[i] + (s0.X[i + 1] - s0.X[i]) * f, y = s0.Y[i] + (s0.Y[i + 1] - s0.Y[i]) * f;
  const x1 = s1.X[i] + (s1.X[i + 1] - s1.X[i]) * f, y1 = s1.Y[i] + (s1.Y[i + 1] - s1.Y[i]) * f;
  const zz = z + shear(z, y, s0.b, s0.f), zz1 = z + 0.004 + shear(z + 0.004, y1, s1.b, s1.f);
  outP.set(side * x, y, zz);
  if (outN) {
    _tr.set(s0.X[i + 1] - s0.X[i], s0.Y[i + 1] - s0.Y[i], 0);
    _tz.set(x1 - x, y1 - y, zz1 - zz);
    outN.crossVectors(_tr, _tz).normalize();
    outN.x *= side;
  }
  return outP;
}
/** Ring index on the rising side (0..I_CREASE) where the skin reaches height y. */
export function uAtY(z, y) {
  const s = section(z);
  for (let k = 0; k < I_CREASE; k++) {
    if (y >= s.Y[k] && y <= s.Y[k + 1]) return k + (y - s.Y[k]) / Math.max(1e-9, s.Y[k + 1] - s.Y[k]);
  }
  return y < s.Y[0] ? 0 : I_CREASE;
}
/** Ring index on the top surface (I_CREASE..RING-1) where the skin is at lateral |x|. */
export function uAtX(z, x) {
  const s = section(z), ax = Math.abs(x);
  for (let k = I_CREASE; k < RING - 1; k++) {
    if (ax <= s.X[k] && ax >= s.X[k + 1]) return k + (s.X[k] - ax) / Math.max(1e-9, s.X[k] - s.X[k + 1]);
  }
  return ax > s.X[I_CREASE] ? I_CREASE : RING - 1;
}

// ---- glass canopy -----------------------------------------------------------------------------
export const CANOPY_TH_EDGE = 0.7;   // roof-rail parameter (A-pillar top / roof panel edge)
function canopyH(z) {
  const e = clamp((z - ZC0) / 0.035, 0, 1) * clamp((ZC1 - z) / 0.09, 0, 1);
  return Math.max(0, ROOF(z) - TC(z)) * sstep(e);
}
/** Canopy surface: z in [ZC0, ZC1], th 0 (rim, side) .. PI/2 (roof centre). */
export function canopyPoint(z, th, side, out) {
  const w = HW(z), f = FT(z), t = TC(z);
  const xc = w - 0.13, xr = w - RIM_IN;
  const H = canopyH(z);
  const hf = clamp(H / 0.22, 0, 1);
  const c = Math.max(0, Math.cos(th)), s = Math.max(0, Math.sin(th));
  const cx = Math.pow(c, 2 / 2.6), sy = Math.pow(s, 2 / 1.7);
  const x = xr * cx * (1 - 0.2 * hf * Math.pow(sy, 1.3));
  const y = t + (f - t) * sstep(x / xc) + H * sy;
  return out.set(side * x, y, z);
}
const _c0 = new THREE.Vector3(), _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
export function canopyNormal(z, th, side, out) {
  canopyPoint(z, th, side, _c0);
  canopyPoint(Math.min(ZC1, z + 0.004), th, side, _c1);
  canopyPoint(z, Math.min(Math.PI / 2, th + 0.004), side, _c2);
  _c1.sub(_c0); _c2.sub(_c0);
  out.crossVectors(_c2, _c1).normalize();
  if (out.y < 0 && Math.abs(out.x) < 0.5) out.negate();
  if (out.x * side < -0.3) out.negate();
  return out;
}
export function canopyStations() {
  const s = [ZC0, ZC0 + 0.006, ZC0 + 0.014, ZC0 + 0.024, ZC0 + 0.036];
  const n = 46;
  for (let i = 1; i <= n; i++) s.push(ZC0 + 0.036 + ((ZC1 - ZC0 - 0.036) * i) / n);
  return s;
}
export function buildCanopyGeometry() {
  const zs = canopyStations(), K = 16;
  const rows = zs.map((z) => {
    const P = new Float32Array((K + 1) * 3);
    for (let k = 0; k <= K; k++) { canopyPoint(z, (k / K) * (Math.PI / 2), 1, _p0); P[k * 3] = _p0.x; P[k * 3 + 1] = _p0.y; P[k * 3 + 2] = _p0.z; }
    return { z, P };
  });
  const g = loftMirrored(rows, 'P', K + 1, null, 1, (row, k) => [row.z, k / K]);
  orient(g, (c, e) => e.set(c.x, c.y - 0.6, 0));
  return g;
}

// ---- ribbons and patches ----------------------------------------------------------------------
/** Strip along samples [{p, n}] of given width, lifted along the normal. */
export function ribbonGeometry(samples, width, lift = 0.0015) {
  const n = samples.length, pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  const t = new THREE.Vector3(), b = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    const { p, n: nn } = samples[i];
    const pa = samples[Math.max(0, i - 1)].p, pb = samples[Math.min(n - 1, i + 1)].p;
    t.subVectors(pb, pa).normalize();
    b.crossVectors(t, nn).normalize().multiplyScalar(width / 2);
    if (i > 0) len += p.distanceTo(samples[i - 1].p);
    for (let s = 0; s < 2; s++) {
      const sg = s === 0 ? -1 : 1, o = (i * 2 + s) * 3;
      pos[o] = p.x + b.x * sg + nn.x * lift; pos[o + 1] = p.y + b.y * sg + nn.y * lift; pos[o + 2] = p.z + b.z * sg + nn.z * lift;
      nor[o] = nn.x; nor[o + 1] = nn.y; nor[o + 2] = nn.z;
      uv[(i * 2 + s) * 2] = len; uv[(i * 2 + s) * 2 + 1] = s;
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const a = i * 2, c = a + 2; idx.push(a, a + 1, c, a + 1, c + 1, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  orientByNormals(g);
  return g;
}
/** Grid patch from a sampler (u,v) -> {p, n} (both THREE.Vector3, fresh per call or copied). */
export function patchGeometry(nu, nv, sampler, lift = 0.002) {
  const pos = [], nor = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const s = sampler(i / nu, j / nv);
    pos.push(s.p.x + s.n.x * lift, s.p.y + s.n.y * lift, s.p.z + s.n.z * lift);
    nor.push(s.n.x, s.n.y, s.n.z);
    uv.push(i / nu, j / nv);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  orientByNormals(g);
  return g;
}
// make triangle winding agree with the supplied vertex normals
function orientByNormals(g) {
  const p = g.attributes.position, nn = g.attributes.normal, ix = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), m = new THREE.Vector3();
  let score = 0;
  for (let i = 0; i < ix.length; i += 3) {
    a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]);
    n.subVectors(b, a).cross(t.subVectors(c, a));
    m.fromBufferAttribute(nn, ix[i]);
    score += n.dot(m);
  }
  if (score < 0) for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; }
}

/** Brute-force ray caster over a triangle soup with smooth (interpolated) normals. */
export class SurfaceProjector {
  constructor(geometries, filter) {
    const P = [], N = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (const g of geometries) {
      const pos = g.attributes.position, nor = g.attributes.normal, ix = g.index ? g.index.array : null;
      const cnt = ix ? ix.length : pos.count;
      for (let i = 0; i < cnt; i += 3) {
        const i0 = ix ? ix[i] : i, i1 = ix ? ix[i + 1] : i + 1, i2 = ix ? ix[i + 2] : i + 2;
        a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
        if (filter && !filter(a, b, c)) continue;
        P.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        for (const k of [i0, i1, i2]) N.push(nor.getX(k), nor.getY(k), nor.getZ(k));
      }
    }
    this.P = new Float32Array(P); this.N = new Float32Array(N);
    this.hit = { p: new THREE.Vector3(), n: new THREE.Vector3(), t: 0 };
  }
  /** Returns the hit object (reused) or null. */
  cast(o, d) {
    const P = this.P, N = this.N;
    let best = Infinity, bi = -1, bu = 0, bv = 0;
    for (let i = 0; i < P.length; i += 9) {
      const e1x = P[i + 3] - P[i], e1y = P[i + 4] - P[i + 1], e1z = P[i + 5] - P[i + 2];
      const e2x = P[i + 6] - P[i], e2y = P[i + 7] - P[i + 1], e2z = P[i + 8] - P[i + 2];
      const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = o.x - P[i], ty = o.y - P[i + 1], tz = o.z - P[i + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-5 && t < best) { best = t; bi = i; bu = u; bv = v; }
    }
    if (bi < 0) return null;
    const h = this.hit, w = 1 - bu - bv;
    h.t = best;
    h.p.set(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best);
    h.n.set(N[bi] * w + N[bi + 3] * bu + N[bi + 6] * bv, N[bi + 1] * w + N[bi + 4] * bu + N[bi + 7] * bv, N[bi + 2] * w + N[bi + 5] * bu + N[bi + 8] * bv).normalize();
    return h;
  }
}

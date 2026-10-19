// Bay Bridge western span superstructure (San Francisco – Oakland Bay Bridge, West Bay crossing).
//
// Two back-to-back suspension bridges: SF anchorage A ─354─ W2 ─704─ W3 ─354─ W4 (central concrete
// anchorage) ─354─ W5 ─704─ W6 ─354─ YBI anchorage. Built along the real OSM deck polyline by arc length.
// The road surfaces (upper westbound + lower eastbound) and their deck heights belong to RoadNetwork.js; this
// module derives every height from the road network at runtime (net.deckHash) and only adds the steel:
// four twin-leg X-braced towers with portal tops, main cables (parabolic, sag 1/9), suspender ropes every
// 15 m, the ~10 m deep stiffening truss around both decks, steel truss bents in the SF side span, the
// concrete SF / central / Yerba Buena anchorages and tower caissons, and blinking aircraft-warning lights.
//
// Draw calls: steel (towers + truss + cables + suspenders, one merged mesh), concrete (anchorages +
// caissons, uses the world's concrete material), warning lights (instanced) = 3.
// Plugged into the engine MapWorld by bayBridgePlugin() (src/world/World.js): built after the street furniture,
// before traffic; the deck heights come from the engine RoadNetwork `deckHolds` rule the game passes.
import * as THREE from 'three';
import { polygonToBoxes } from '@vibe/engine/physics';
import { RBIT } from '@vibe/engine/world';
import { PBR } from '@vibe/engine/world';

// ---- real dimensions (metres)
const SIDE = 354, MAIN = 704;
const TOWER_ABOVE_WATER = 158, DECK_REF = 58;  // tower top above water for a 58 m deck (shifted with the real deck)
const SAG_MAIN = MAIN / 9;
const SAG_SIDE = SAG_MAIN * (SIDE / MAIN) ** 2; // same horizontal cable tension
const W4_TOP = 90;            // central anchorage height above water
const SUSP_SPACING = 15;
const PANEL = 10;             // stiffening truss panel length
const TRUSS_DEPTH = 9.5;      // top chord -> bottom chord (lower deck ~9 m under the upper)
const LEG_ACROSS = 4.6, LEG_ALONG_BASE = 9.0, LEG_ALONG_TOP = 6.2, LEG_ACROSS_TOP = 3.8;
const CABLE_R = 0.6;
const COL_KIND = 5;           // same collider kind World uses for bridge piers
const CLEAR_ROAD_PIERS = true; // remove RoadNetwork.js' generic concrete deck columns inside the suspended spans

// steel vertex colour = shader flags: r = radius of a thin member (min-pixel-width growth), g = 1 riveted plate seams
const STEEL_C = [0, 1, 0];
const CABLE_C = [CABLE_R, 0, 0], ROPE_C = [0.14, 0, 0], RAIL_C = [0.05, 0, 0];
const CONC = [0.74, 0.72, 0.68], CONC_DARK = [0.6, 0.59, 0.56];

const waterLevel = (world) => (world && Number.isFinite(world.waterLevel) ? world.waterLevel : -0.6);

// ------------------------------------------------------------------ materials
/**
 * Painted steel: grey paint with a mottled roughness, riveted plate seams (Geo uv = metres / 4) on the
 * towers / truss, and thin members (cables, suspender ropes, rails; vertex colour r = radius) grown in the
 * vertex shader so they stay ~1.5 px wide at any distance instead of breaking up.
 */
function createBridgeSteelMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.47, 0.5, 0.53, THREE.SRGBColorSpace), roughness: 0.5, metalness: 0.35, vertexColors: true });
  const u = { uPix: { value: 0.0016 } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPix = u.uPix;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uPix; varying vec2 vSUv; varying vec3 vSPos; varying vec3 vFlag;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFlag = color; vSUv = uv * 4.0;
if (color.g < 0.5 && color.r > 0.0) {
  vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
  transformed += objectNormal * max(0.0, uPix * distance(wp0, cameraPosition) * 0.75 - color.r);
}
vSPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vSUv; varying vec3 vSPos; varying vec3 vFlag;
float bHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bNoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bHash(i), bHash(i + vec3(1,0,0)), f.x), mix(bHash(i + vec3(0,1,0)), bHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bHash(i + vec3(0,0,1)), bHash(i + vec3(1,0,1)), f.x), mix(bHash(i + vec3(0,1,1)), bHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `float bSeam = 0.0, bRiv = 0.0;
float bN = bNoise(vSPos * 0.35) * 0.65 + bNoise(vSPos * 2.1) * 0.35;
if (vFlag.g > 0.5) {
  vec2 cellSz = vec2(2.4, 1.8);
  vec2 dl = (0.5 - abs(fract(vSUv / cellSz) - 0.5)) * cellSz;          // metres to the nearest plate seam
  vec2 aa = fwidth(vSUv) * 1.2 + 1e-4;
  float sx = 1.0 - smoothstep(0.012, 0.012 + aa.x, dl.x), sy = 1.0 - smoothstep(0.012, 0.012 + aa.y, dl.y);
  bSeam = max(sx, sy);
  // rivet rows 6 cm either side of each seam, 15 cm pitch
  vec2 rp = abs(fract(vSUv / 0.15) - 0.5) * 0.15;
  float rx = (1.0 - smoothstep(0.012, 0.012 + aa.x, abs(dl.x - 0.06))) * (1.0 - smoothstep(0.014, 0.014 + aa.y, rp.y));
  float ry = (1.0 - smoothstep(0.012, 0.012 + aa.y, abs(dl.y - 0.06))) * (1.0 - smoothstep(0.014, 0.014 + aa.x, rp.x));
  bRiv = max(rx, ry) * (1.0 - smoothstep(0.02, 0.06, max(aa.x, aa.y))); // fade out before they alias
  bSeam *= 1.0 - smoothstep(0.05, 0.2, max(aa.x, aa.y)) * 0.6;
}
diffuseColor.rgb *= (1.0 - 0.5 * bSeam - 0.3 * bRiv) * (0.93 + 0.14 * bN);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(0.4 + 0.22 * bN + 0.25 * bSeam, 0.25, 0.9);');
  };
  m.customProgramCacheKey = () => 'roadster-bridge-steel-1';
  m.userData.u = u;
  return m;
}

/**
 * Pier / anchorage concrete: the rough-concrete PBR set (facade texture array) at real-world scale, with
 * weathering - dark wet splash zone and green-brown algae at the waterline, a pale salt line above it,
 * vertical rain streaks on the walls and large-scale mottling. Returns null without the PBR textures.
 */
function createBridgeConcreteMaterial(tex, W) {
  const pbr = tex && tex.pbr;
  if (!pbr || !pbr.albedo || !pbr.normal) return null;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const u = { uPA: { value: pbr.albedo }, uPN: { value: pbr.normal }, uLayer: { value: PBR.CONCRETE_ROUGH }, uSize: { value: (pbr.sizes && pbr.sizes[PBR.CONCRETE_ROUGH]) || 2.7 }, uW: { value: W } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCUv; varying vec3 vCPos; varying vec3 vCN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCUv = uv * 6.0; vCPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vCN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2DArray uPA; uniform highp sampler2DArray uPN; uniform float uLayer; uniform float uSize; uniform float uW;
varying vec2 vCUv; varying vec3 vCPos; varying vec3 vCN;
float cHash(float n) { return fract(sin(n) * 43758.5453); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec4 cA = texture(uPA, vec3(vCUv / uSize, uLayer));
vec4 cNm = texture(uPN, vec3(vCUv / uSize, uLayer));
vec4 cA2 = texture(uPA, vec3(vCUv / (uSize * 7.3) + 0.37, uLayer));
float cWall = 1.0 - step(0.6, abs(vCN.y));
float hW = vCPos.y - uW;
float ragged = 0.5 * cHash(floor(vCUv.x * 3.1) * 3.7);                       // uneven upper edge of the zones
float wet = (1.0 - smoothstep(1.4 + ragged, 3.2 + ragged, hW)) * cWall;
float salt = smoothstep(3.0 + ragged, 3.3 + ragged, hW) * (1.0 - smoothstep(3.3 + ragged, 4.2 + ragged, hW)) * cWall;
float algae = (1.0 - smoothstep(-0.4, 1.6 + ragged, hW)) * cWall;
// rain / run-off streaks: narrow columns, varying length and strength
float colId = floor(vCUv.x * 2.2);
float cs = cHash(colId * 7.31);
float streak = smoothstep(0.45, 1.0, cs) * (0.5 + 0.5 * sin(vCUv.y * (0.18 + 0.2 * cHash(colId + 3.0)) + cs * 6.28)) * cWall;
streak *= 1.0 - smoothstep(0.25, 0.5, abs(fract(vCUv.x * 2.2) - 0.5));       // soft column edges
vec3 cc = cA.rgb * 0.88 * (0.78 + 0.42 * dot(cA2.rgb, vec3(0.33)));
cc *= 1.0 - 0.38 * streak;
cc = mix(cc, cc * vec3(0.34, 0.36, 0.31), wet);
cc = mix(cc, vec3(0.1, 0.13, 0.07), algae * 0.75);
cc = mix(cc, cc * 1.3 + 0.04, salt * 0.55);
diffuseColor.rgb *= cc;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(cNm.b, 0.5, wet * 0.8);')
      .replace('#include <normal_fragment_maps>', `{
  vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
  vec2 st0 = dFdx(vCUv), st1 = dFdy(vCUv);
  vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
  vec3 Tt = q1p * st0.x + q0p * st1.x, Bt = q1p * st0.y + q0p * st1.y;
  float det = max(dot(Tt, Tt), dot(Bt, Bt)); float sc = det == 0.0 ? 0.0 : inversesqrt(det);
  vec2 nxy = (cNm.rg * 2.0 - 1.0) * 0.9;
  vec3 mapN = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  normal = normalize(Tt * (mapN.x * sc) + Bt * (mapN.y * sc) + normal * mapN.z);
}`);
  };
  m.customProgramCacheKey = () => 'roadster-bridge-concrete-1';
  return m;
}

// ------------------------------------------------------------------ geometry buffer
class Geo {
  constructor(uvScale = 6) { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; this.uvScale = uvScale; }
  v(x, y, z, nx, ny, nz, c) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz);
    const s = this.uvScale;
    if (Math.abs(ny) >= 0.6) this.uv.push(x / s, z / s); else this.uv.push((x * Math.abs(nz) + z * Math.abs(nx)) / s, y / s);
    this.col.push(c[0], c[1], c[2]);
    return this.n++;
  }
  /** Planar quad (p0..p3 any winding); normal from geometry, flipped to agree with `hint` (outward). */
  quad(p0, p1, p2, p3, hint, c = STEEL_C) {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let flip = false;
    if (hint && nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { nx = -nx; ny = -ny; nz = -nz; flip = true; }
    const a = this.v(p0[0], p0[1], p0[2], nx, ny, nz, c), b = this.v(p1[0], p1[1], p1[2], nx, ny, nz, c);
    const d = this.v(p2[0], p2[1], p2[2], nx, ny, nz, c), e = this.v(p3[0], p3[1], p3[2], nx, ny, nz, c);
    if (flip) this.idx.push(a, d, b, a, e, d); else this.idx.push(a, b, d, a, d, e);
  }
  /** Hexahedron from 8 corners: bottom ring c[0..3], top ring c[4..7] (same order). */
  hexa(c, col = STEEL_C, { top = true, bottom = true } = {}) {
    let cx = 0, cy = 0, cz = 0; for (const p of c) { cx += p[0]; cy += p[1]; cz += p[2]; } cx /= 8; cy /= 8; cz /= 8;
    const out = (pts) => { let x = 0, y = 0, z = 0; for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; } return [x / 4 - cx, y / 4 - cy, z / 4 - cz]; };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, f = [c[i], c[j], c[j + 4], c[i + 4]];
      this.quad(f[0], f[1], f[2], f[3], out(f), col);
    }
    if (top) { const f = [c[4], c[5], c[6], c[7]]; this.quad(f[0], f[1], f[2], f[3], out(f), col); }
    if (bottom) { const f = [c[0], c[1], c[2], c[3]]; this.quad(f[0], f[1], f[2], f[3], out(f), col); }
  }
  /** Prismatic member from a to b; sw = width along `side`, sh = height along the member's up. */
  beam(a, b, sw, sh, sideHint, col = STEEL_C, caps = false) {
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz); if (L < 1e-3) return;
    dx /= L; dy /= L; dz /= L;
    let sx, sy, sz;
    if (Math.abs(dy) < 0.985) { sx = -dz; sy = 0; sz = dx; } // horizontal side, perpendicular in plan
    else { sx = sideHint[0]; sy = sideHint[1]; sz = sideHint[2]; }
    if (sideHint && sx * sideHint[0] + sy * sideHint[1] + sz * sideHint[2] < 0) { sx = -sx; sy = -sy; sz = -sz; }
    let l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
    let ux = sy * dz - sz * dy, uy = sz * dx - sx * dz, uz = sx * dy - sy * dx;
    l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    if (uy < 0) { ux = -ux; uy = -uy; uz = -uz; }
    const hw = sw / 2, hh = sh / 2;
    const corner = (p, i, k) => [p[0] + sx * hw * i + ux * hh * k, p[1] + sy * hw * i + uy * hh * k, p[2] + sz * hw * i + uz * hh * k];
    const ring = (p) => [corner(p, -1, -1), corner(p, 1, -1), corner(p, 1, 1), corner(p, -1, 1)];
    const A = ring(a), B = ring(b);
    this.hexa([...A, ...B], col, { top: caps, bottom: caps });
  }
  /** Smooth tube through 3D points. */
  tube(pts, r, seg = 8, col = STEEL_C) {
    if (pts.length < 2) return;
    const base = this.n;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
      let tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2];
      let l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
      let sx = -tz, sz = tx; l = Math.hypot(sx, sz) || 1; sx /= l; sz /= l; // horizontal side
      const ux = -sz * ty, uy = sz * tx - sx * tz, uz = sx * ty;          // up = side x t
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = sx * ca + ux * sa, ny = uy * sa, nz = sz * ca + uz * sa;
        this.pos.push(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r); this.nor.push(nx, ny, nz);
        this.uv.push(k / seg, i); this.col.push(col[0], col[1], col[2]); this.n++;
      }
    }
    for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < seg; k++) {
      const a = base + i * seg + k, b = base + i * seg + ((k + 1) % seg), c = a + seg, d = b + seg;
      this.idx.push(a, c, b, b, c, d);
    }
  }
  get triangles() { return this.idx.length / 3; }
  build(mat, name, { cast = true, receive = true } = {}) {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.castShadow = cast; m.receiveShadow = receive;
    m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  }
}

// ------------------------------------------------------------------ bridge axis (arc-length sampler)
class Axis {
  constructor(pts) {
    this.pts = pts; this.s = [0];
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    this.L = this.s[this.s.length - 1];
    // Douglas-Peucker simplified copy (0.4 m) for fast projection
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const dp = (i0, i1) => {
      const a = pts[i0], b = pts[i1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      let m = -1, md = 0.4;
      for (let i = i0 + 1; i < i1; i++) { const d = Math.abs((pts[i][0] - a[0]) * dz - (pts[i][1] - a[1]) * dx) / l; if (d > md) { md = d; m = i; } }
      if (m >= 0) { keep[m] = 1; dp(i0, m); dp(m, i1); }
    };
    dp(0, pts.length - 1);
    this.simp = []; for (let i = 0; i < pts.length; i++) if (keep[i]) this.simp.push(i);
  }
  /** {x,z,dx,dz} at arc length s (direction from a 60 m chord so the structure stays straight). */
  at(s) {
    const x = this._p(s), a = this._p(s - 30), b = this._p(s + 30);
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    return { x: x[0], z: x[1], dx, dz };
  }
  _p(s) {
    const S = this.s, P = this.pts, n = P.length;
    if (s <= 0) { const d = this._dir(0); return [P[0][0] + d[0] * s, P[0][1] + d[1] * s]; }
    if (s >= this.L) { const d = this._dir(n - 2); return [P[n - 1][0] + d[0] * (s - this.L), P[n - 1][1] + d[1] * (s - this.L)]; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const t = (s - S[lo]) / ((S[hi] - S[lo]) || 1);
    return [P[lo][0] + (P[hi][0] - P[lo][0]) * t, P[lo][1] + (P[hi][1] - P[lo][1]) * t];
  }
  _dir(i) { const a = this.pts[i], b = this.pts[i + 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
  /** World point at arc s, lateral u (+ = right of the SF->YBI direction), height y. */
  pt(s, u, y) { const a = this.at(s); return [a.x - a.dz * u, y, a.z + a.dx * u]; }
  /** Project (x,z) -> [s, lateral] (coarse search + refine). */
  project(x, z) {
    let best = Infinity, bs = 0, bu = 0;
    const P = this.pts, K = this.simp;
    for (let k = 0; k < K.length - 1; k++) {
      const a = P[K[k]], b = P[K[k + 1]], dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
      if (L2 < 1e-6) continue;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; const L = Math.sqrt(L2); bs = this.s[K[k]] + t * (this.s[K[k + 1]] - this.s[K[k]]); bu = ((x - a[0]) * -dz + (z - a[1]) * dx) / L; }
    }
    return [bs, bu, best];
  }
}

// ------------------------------------------------------------------ the bridge
export class BayBridge {
  constructor({ world, data, net, colliders, mat, tex }) {
    this.world = world; this.data = data; this.net = net; this.colliders = colliders; this.mat = mat; this.tex = tex;
    this.group = null; this.lights = null; this.time = 0;
    this.stats = { triangles: 0, drawCalls: 0, towers: 0, colliders: 0 };
  }

  /** Build meshes and add collider boxes; return a THREE.Object3D (or null). */
  build() {
    const W = waterLevel(this.world);
    this.W = W;
    this._colStart = this.colliders && this.colliders.boxes ? this.colliders.boxes.length : 0; // boxes added before the bridge
    const axis = this._findAxis();
    if (!axis) { console.info('[BayBridge] no Bay Bridge deck in the road network'); return null; }
    this.axis = axis;
    const L = axis.L;
    this._sampleDecks();
    const layout = this._layout();
    if (!layout) return null;
    this.layout = layout;

    const steel = new Geo(4), conc = new Geo(6);
    this.steel = steel; this.conc = conc;
    this._lightPos = [];
    const { sA, sW2, sW3, sW4, sW5, sW6, sY } = layout;
    const fits = (s, m = 0) => s !== null && s > m && s < L - m;

    // deck reference height over the suspended spans
    let deckRef = 0;
    for (let s = Math.max(0, sA); s <= Math.min(L, sY ?? L); s += 20) deckRef = Math.max(deckRef, this.deckU(s));
    this.towerTop = W + TOWER_ABOVE_WATER + Math.max(0, deckRef - DECK_REF);
    this.saddleY = this.towerTop - 1.5;

    // ---- stiffening truss (whole length where the upper deck is elevated)
    const sEnd = fits(sY, 5) ? sY : L;
    this._truss(0, sEnd);

    // ---- towers, anchorages, bents
    const towers = [sW2, sW3, sW5, sW6].filter((s) => fits(s, 20));
    for (const s of towers) this._tower(s);
    this.stats.towers = towers.length;
    if (fits(sA, 5)) this._endAnchorage(sA, +1);
    if (fits(sW4, 30)) this._centralAnchorage(sW4);
    if (fits(sY, 25)) this._endAnchorage(sY, -1);
    if (fits(sA, 5) && fits(sW2, 20)) this._bents(sA, sW2);

    // ---- cables + suspenders
    const anchorY = (s) => this.deckU(s) + 7;
    const ends = []; // cable spans: [s0, y0, s1, y1, sag]
    const top = this.saddleY, w4y = W + W4_TOP - 5;
    const has = (s) => s !== null && s >= -1 && s <= L + 1;
    if (has(sA) && fits(sW2, 20)) ends.push([sA + 16, anchorY(sA), sW2, top, SAG_SIDE]);
    if (fits(sW2, 20) && fits(sW3, 20)) ends.push([sW2, top, sW3, top, SAG_MAIN]);
    if (fits(sW3, 20) && fits(sW4, 30)) ends.push([sW3, top, sW4 - 22, w4y, SAG_SIDE]);
    if (fits(sW4, 30) && fits(sW5, 20)) ends.push([sW4 + 22, w4y, sW5, top, SAG_SIDE]);
    if (fits(sW5, 20) && fits(sW6, 20)) ends.push([sW5, top, sW6, top, SAG_MAIN]);
    if (fits(sW6, 20) && fits(sY, 25)) ends.push([sW6, top, sY - 16, anchorY(sY), SAG_SIDE]);
    // partial span when the polyline ends between towers: cable runs to the deck end and stops at a
    // tie-down bent (keeps the silhouette without inventing land that is not in the data)
    for (const sp of ends) this._cableSpan(...sp);

    // ---- lower-deck slab where RoadNetwork.js has no second deck under the upper one
    this._lowerSlab(0, sEnd);
    // ---- steel railings on the deck barriers, floor system under both decks, lower-deck ceiling lamps
    this._lampPos = [];
    try { this._deckDetails(); } catch (e) { console.warn('[BayBridge] deck details skipped', e); }

    // ---- remove the generic concrete deck columns RoadNetwork.js put inside the suspended spans + the OSM tower box
    if (CLEAR_ROAD_PIERS) {
      try { this._clearRoadPiers(Math.max(0, sA) + 12, (fits(sY, 25) ? sY : L) - 12); } catch (e) { console.warn('[BayBridge] pier clean-up skipped', e); }
    }
    try { this._hideOsmTowers(towers); } catch (e) { console.warn('[BayBridge] OSM tower clean-up skipped', e); }

    // ---- meshes
    const g = new THREE.Group(); g.name = 'bay-bridge';
    const steelMat = createBridgeSteelMaterial();
    this.steelMat = steelMat;
    const ms = steel.build(steelMat, 'bay-bridge-steel'); if (ms) g.add(ms);
    const concMat = createBridgeConcreteMaterial(this.tex, W) || (this.mat && this.mat.concrete ? this.mat.concrete : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    const mc = conc.build(concMat, 'bay-bridge-concrete'); if (mc) g.add(mc);
    this._buildLights(g);
    this._buildDeckLamps(g);
    this.group = g;
    this.stats.triangles = steel.triangles + conc.triangles + (this.lights ? this.lights.count * this.lights.geometry.index.count / 3 : 0);
    this.stats.drawCalls = g.children.length;
    this.stats.layout = Object.fromEntries(Object.entries(layout).map(([k, v]) => [k, v === null ? null : Math.round(v)]));
    this.stats.towerTop = +this.towerTop.toFixed(1);
    this.stats.deckRef = +deckRef.toFixed(1);
    console.info('[BayBridge] built', this.stats);
    return g;
  }

  update(dt, cameraPos, darkness) {
    if (this.steelMat) {
      // world size of one pixel per metre of distance, for the thin-member minimum width
      const cam = typeof window !== 'undefined' ? ((window.__game && window.__game.camera) || (window.__three && window.__three.camera)) : null;
      const H = this.world && this.world.renderer && this.world.renderer.domElement ? this.world.renderer.domElement.height : 900;
      const fov = cam && cam.fov ? cam.fov : 65;
      this.steelMat.userData.u.uPix.value = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(300, H);
    }
    if (this.deckLamps) {
      const k = (darkness || 0) > 0.25 ? 1.0 + 2.2 * Math.min(1, ((darkness || 0) - 0.25) / 0.4) : 0.25;
      if (this._deckK !== k) { this._deckK = k; this.deckLamps.material.color.setRGB(k, k * 0.86, k * 0.62); }
    }
    if (!this.lights) return;
    this.time += Number.isFinite(dt) ? dt : 0;
    const night = (darkness || 0) > 0.5;
    const on = !night || (this.time % 1.5) < 0.75;
    const k = night ? (on ? 2.4 : 0.04) : 0.45;
    if (this._lightK !== k) { this._lightK = k; this.lights.material.color.setRGB(k, k * 0.035, k * 0.02); }
  }

  // ================================================================ analysis
  _findAxis() {
    const net = this.net;
    if (!net || !Array.isArray(net.list)) return null;
    const W = waterLevel(this.world);
    let best = null, bestScore = -Infinity;
    for (const e of net.list) {
      if (!e || !e.bridge || !Array.isArray(e.pts) || e.pts.length < 2) continue;
      let len = 0, wet = 0, hsum = 0;
      for (let i = 1; i < e.pts.length; i++) {
        const a = e.pts[i - 1], b = e.pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        len += l;
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        if (this.world && typeof this.world.isLand === 'function' && !this.world.isLand(mx, mz)) wet += l;
        if (e.hs) hsum += l * ((e.hs[i - 1] + e.hs[i]) / 2);
      }
      if (len < 1200 || wet < 800) continue;
      const named = /bay bridge|eisenhower|i-80|interstate 80/i.test(e.name || '') ? 1 : 0;
      const score = named * 1e6 + wet + hsum / len * 10; // prefer the higher (upper, westbound) deck
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (!best) return null;
    let pts = best.pts.map((p) => [p[0], p[1]]);
    let hs = best.hs ? best.hs.slice() : null;
    // s = 0 at the San Francisco end: the end nearer the city (spawn) / on land
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.hypot(a[0], a[1]) > Math.hypot(b[0], b[1])) { pts.reverse(); if (hs) hs.reverse(); }
    this._axisHs = hs;
    void W;
    return new Axis(pts);
  }

  /** Sample upper / lower deck heights + lateral extents along the axis every 5 m. */
  _sampleDecks() {
    const ax = this.axis, step = 5, n = Math.ceil(ax.L / step) + 1;
    this._step = step;
    this._U = new Float32Array(n); this._Lo = new Float32Array(n); this._other = new Uint8Array(n);
    const hash = this.net.deckHash;
    const ext = [];
    const ahs = this._axisHs;
    for (let i = 0; i < n; i++) {
      const s = Math.min(ax.L, i * step), a = ax.at(s);
      const found = [];
      if (hash && typeof hash.forEachNear === 'function') {
        for (const off of [-5, 0, 5]) {
          const x = a.x - a.dz * off, z = a.z + a.dx * off;
          hash.forEachNear(x, z, 0, (sg, t) => {
            const dx = sg.bx - sg.ax, dz = sg.bz - sg.az, l = Math.hypot(dx, dz) || 1;
            if (Math.abs((dx * a.dx + dz * a.dz) / l) < 0.95) return; // only decks parallel to the bridge
            const h = sg.ha + (sg.hb - sg.ha) * t;
            const px = sg.ax + dx * t, pz = sg.az + dz * t;
            const u = (px - a.x) * -a.dz + (pz - a.z) * a.dx;
            if (Math.abs(u) > 14) return;
            found.push({ h, u, hw: (sg.hw || 9) + 0.1 });
          });
        }
      }
      let U = -Infinity, Lo = NaN, other = 0, uU = 0, hwU = 9;
      for (const f of found) if (f.h > U) { U = f.h; uU = f.u; hwU = f.hw; }
      if (!found.length) {
        U = ahs ? this._interpHs(s) : 0;
      } else {
        for (const f of found) {
          if (Math.abs(f.h - U) > 0.6 || Math.abs(f.u - uU) > 1.5) other = 1;
          if (f.h < U - 2.5 && !(f.h <= Lo)) Lo = f.h;
        }
        ext.push({ s, l: Math.min(...found.map((f) => f.u - f.hw)), r: Math.max(...found.map((f) => f.u + f.hw)) });
      }
      this._U[i] = U; this._Lo[i] = Number.isFinite(Lo) ? Lo : NaN; this._other[i] = other;
      void hwU;
    }
    // truss lateral extents: robust (median) over the elevated part
    const med = (arr) => { const v = arr.slice().sort((p, q) => p - q); return v.length ? v[v.length >> 1] : 0; };
    const ls = ext.map((e) => e.l), rs = ext.map((e) => e.r);
    const l = ls.length ? med(ls) : -9.3, r = rs.length ? med(rs) : 9.3;
    this.trussC = (l + r) / 2;
    this.trussT = Math.max(6, (r - l) / 2 + 0.45);
    this.legU = this.trussT + LEG_ACROSS / 2 + 0.7;  // tower leg / cable plane offset from the truss centre
  }
  _interpHs(s) {
    const ax = this.axis, hs = this._axisHs, S = ax.s;
    let i = 0; while (i < S.length - 2 && S[i + 1] < s) i++;
    const t = Math.max(0, Math.min(1, (s - S[i]) / ((S[i + 1] - S[i]) || 1)));
    return hs[i] + (hs[i + 1] - hs[i]) * t;
  }
  _idx(s) { return Math.max(0, Math.min(this._U.length - 1, Math.round(s / this._step))); }
  deckU(s) { return this._U[this._idx(s)]; }
  deckLo(s) { return this._Lo[this._idx(s)]; }
  ground(x, z) {
    const w = this.world;
    if (w && typeof w.getGroundHeight === 'function') {
      const g = w.getGroundHeight(x, z, -1e4); // y far below every deck -> terrain / water only
      if (Number.isFinite(g)) return g;
    }
    return 0;
  }
  isLand(x, z) { return this.world && typeof this.world.isLand === 'function' ? this.world.isLand(x, z) : true; }

  /** Tower / anchorage stations by arc length from the SF end. */
  _layout() {
    const ax = this.axis, L = ax.L;
    // shoreline: first water sample
    let shore = null;
    for (let s = 0; s < L; s += 4) { const a = ax.at(s); if (!this.isLand(a.x, a.z)) { shore = s; break; } }
    if (shore === null) return null;
    // W2 from the OSM tower footprint (building=tower in the bay, next to the deck) when present
    let sW2 = null, osm = null;
    for (const b of (this.data && this.data.buildings) || []) {
      if (!b || !Array.isArray(b.p) || b.p.length < 3 || b.lod || !((b.h || 0) > 90)) continue;
      let cx = 0, cz = 0; for (const q of b.p) { cx += q[0]; cz += q[1]; } cx /= b.p.length; cz /= b.p.length;
      const [s, u] = ax.project(cx, cz);
      if (Math.abs(u) < 30 && s > shore - 150 && s < shore + 600 && (sW2 === null || s < sW2)) { sW2 = s; osm = b; }
    }
    if (sW2 === null) sW2 = shore + 208; // real offset of W2 from the Embarcadero seawall
    this._osmTower = osm;
    let sA = sW2 - SIDE;
    // keep the SF anchorage block off the street grid (The Embarcadero passes just east of it)
    const r = this.world && this.world.raster;
    if (r && typeof r.any === 'function') {
      const blocked = (s) => { for (let k = -24; k <= 24; k += 6) { const p = ax.pt(s + k, this.trussC, 0); if (r.any(p[0], p[2], 4, RBIT.ROAD)) return true; } return false; };
      for (const d of [0, -6, -12, -18, 6, -24, -30]) if (!blocked(sA + d)) { sA += d; break; }
    }
    const sW3 = sW2 + MAIN, sW4 = sW3 + SIDE, sW5 = sW4 + SIDE, sW6 = sW5 + MAIN, sY = sW6 + SIDE;
    const ok = (s, m) => (s < L - m ? s : null);
    return { shore, sA, sW2: ok(sW2, 20), sW3: ok(sW3, 20), sW4: ok(sW4, 30), sW5: ok(sW5, 20), sW6: ok(sW6, 20), sY: ok(sY, 25) };
  }

  _addCol(ring, y0, y1) {
    if (!this.colliders || !(y1 > y0)) return;
    for (const b of polygonToBoxes(ring, [], 1.5)) { if (this.colliders.add(b[0], y0, b[2], y1, b[1], b[3], COL_KIND) >= 0) this.stats.colliders++; }
  }
  /** Plan rectangle (ring) centred at arc s / lateral u, half sizes along (ha) and across (hu). */
  _rect(s, u, ha, hu) {
    const a = this.axis.at(s), out = [];
    for (const [i, k] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const al = ha * i, ac = hu * k;
      out.push([a.x + a.dx * al - a.dz * (u + ac), a.z + a.dz * al + a.dx * (u + ac)]);
    }
    return out;
  }
  _block(geo, s, u, ha, hu, y0, y1, col, colliders = true, taper = 0) {
    const R0 = this._rect(s, u, ha, hu), R1 = taper ? this._rect(s, u, ha * (1 - taper), hu * (1 - taper * 0.5)) : R0;
    geo.hexa([...R0.map((p) => [p[0], y0, p[1]]), ...R1.map((p) => [p[0], y1, p[1]])], col);
    if (colliders) this._addCol(R0, y0, y1);
  }

  // ================================================================ truss
  _truss(s0, s1) {
    const ax = this.axis, G = this.steel, c = this.trussC, T = this.trussT;
    const nodes = [];
    for (let s = s0; s <= s1 + 1e-6; s += PANEL) {
      const ss = Math.min(s, s1), a = ax.at(ss), U = this.deckU(ss), Lo = this.deckLo(ss);
      const g = this.ground(a.x - a.dz * c, a.z + a.dx * c);
      const top = U - 0.45;
      // full 9.5 m truss over the bay; shallower where RoadNetwork.js brings the deck down near the shores
      const depth = Math.max(3.5, Math.min(TRUSS_DEPTH, 0.45 * (U - g)));
      let bot = Math.min(top - depth, Number.isFinite(Lo) ? Lo - 1.25 : Infinity);
      bot = Math.max(bot, g + 1.5);
      nodes.push({ s: ss, top, bot, ok: U > g + 6 && top - bot > 3 });
      if (ss >= s1) break;
    }
    this._trussNodes = nodes;
    const side = (u) => (n) => ax.pt(n.s, u, 0);
    for (const sg of [-1, 1]) {
      const u = c + sg * T, P = side(u), hint = (n) => { const a = ax.at(n.s); return [-a.dz * sg, 0, a.dx * sg]; };
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], p = P(n);
        if (!n.ok) continue;
        // vertical post
        G.beam([p[0], n.bot, p[2]], [p[0], n.top, p[2]], 0.75, 0.75, hint(n));
        const m = nodes[i + 1];
        if (!m || !m.ok) continue;
        const q = P(m);
        G.beam([p[0], n.top, p[2]], [q[0], m.top, q[2]], 0.9, 1.25, hint(n));          // top chord
        G.beam([p[0], n.bot, p[2]], [q[0], m.bot, q[2]], 0.9, 1.25, hint(n));          // bottom chord
        if (i % 2 === 0) G.beam([p[0], n.bot, p[2]], [q[0], m.top, q[2]], 0.6, 0.6, hint(n)); // Warren diagonals
        else G.beam([p[0], n.top, p[2]], [q[0], m.bot, q[2]], 0.6, 0.6, hint(n));
      }
    }
    // floor beams + bottom lateral X bracing (visible from the water)
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]; if (!n.ok) continue;
      const a = ax.pt(n.s, c - T, n.bot), b = ax.pt(n.s, c + T, n.bot), d = ax.at(n.s);
      G.beam(a, b, 0.8, 1.0, [d.dx, 0, d.dz]);
      const m = nodes[i + 1]; if (!m || !m.ok || i % 2) continue;
      const a2 = ax.pt(m.s, c - T, m.bot), b2 = ax.pt(m.s, c + T, m.bot);
      G.beam(a, b2, 0.35, 0.35, [0, 1, 0]); G.beam(b, a2, 0.35, 0.35, [0, 1, 0]);
    }
  }

  _lowerSlab(s0, s1) {
    // only where no second deck exists under the upper one (RoadNetwork.js usually provides the eastbound lower deck)
    const ax = this.axis, c = this.trussC, T = this.trussT, C = this.conc, G = this.steel;
    let run = null;
    const flush = () => { run = null; };
    for (const n of this._trussNodes || []) {
      const i = this._idx(n.s);
      const need = n.ok && !this._other[i] && !Number.isFinite(this._Lo[i]) && n.s >= s0 && n.s <= s1;
      if (!need) { flush(); continue; }
      const y = n.bot + 1.25;
      if (run) {
        const p = run, d = ax.at(n.s);
        const A0 = ax.pt(p.s, c - T + 0.5, p.y), A1 = ax.pt(p.s, c + T - 0.5, p.y), B0 = ax.pt(n.s, c - T + 0.5, y), B1 = ax.pt(n.s, c + T - 0.5, y);
        C.quad(A0, A1, B1, B0, [0, 1, 0], CONC_DARK);
        C.quad([A0[0], A0[1] - 0.5, A0[2]], [A1[0], A1[1] - 0.5, A1[2]], [B1[0], B1[1] - 0.5, B1[2]], [B0[0], B0[1] - 0.5, B0[2]], [0, -1, 0], CONC_DARK);
        for (const sg of [-1, 1]) {
          const r0 = ax.pt(p.s, c + sg * (T - 0.9), p.y + 0.85), r1 = ax.pt(n.s, c + sg * (T - 0.9), y + 0.85);
          G.beam(r0, r1, 0.25, 0.3, [-d.dz * sg, 0, d.dx * sg]);
        }
      }
      run = { s: n.s, y };
    }
  }

  // ================================================================ towers
  _tower(s) {
    const ax = this.axis, G = this.steel, C = this.conc, c = this.trussC, lu = this.legU;
    const a = ax.at(s);
    const gnd = Math.max(this.W, this.ground(a.x - a.dz * c, a.z + a.dx * c));
    const pierTop = gnd + 9;
    const top = this.towerTop;
    // concrete caisson pier with rounded-looking chamfered ends
    const hu = lu + 7, ha = 13;
    this._block(C, s, c, ha, hu, this.W - 4, pierTop - 2.2, CONC_DARK);
    this._block(C, s, c, ha - 1.2, hu - 1.2, pierTop - 2.2, pierTop, CONC);
    const n = this._trussNodes ? this._trussNodes.reduce((b, q) => (Math.abs(q.s - s) < Math.abs(b.s - s) ? q : b)) : { top: this.deckU(s), bot: this.deckU(s) - TRUSS_DEPTH };
    const tTop = this.deckU(s) - 0.45, tBot = n.bot;
    // legs: tapered, stepped near the top
    const legs = [];
    for (const sg of [-1, 1]) {
      const u = c + sg * lu;
      const R0 = this._rect(s, u, LEG_ALONG_BASE / 2, LEG_ACROSS / 2), R1 = this._rect(s, u, LEG_ALONG_TOP / 2, LEG_ACROSS_TOP / 2);
      const y1 = top - 9;
      G.hexa([...R0.map((p) => [p[0], pierTop, p[1]]), ...R1.map((p) => [p[0], y1, p[1]])], STEEL_C, { bottom: false });
      const R2 = this._rect(s, u, LEG_ALONG_TOP / 2 - 0.5, LEG_ACROSS_TOP / 2 - 0.3);
      G.hexa([...R2.map((p) => [p[0], y1, p[1]]), ...R2.map((p) => [p[0], top, p[1]])], STEEL_C, { bottom: false });
      // vertical stiffener ribs on the outer faces (reads as the cellular leg at distance)
      const rib = (al) => { const p0 = ax.pt(s + al, u + sg * (LEG_ACROSS / 2 + 0.25), pierTop), p1 = ax.pt(s + al * (LEG_ALONG_TOP / LEG_ALONG_BASE), u + sg * (LEG_ACROSS_TOP / 2 + 0.25), y1); G.beam(p0, p1, 0.6, 0.5, [a.dx, 0, a.dz]); };
      rib(-LEG_ALONG_BASE / 4); rib(LEG_ALONG_BASE / 4);
      // cable saddle housing
      const Rs = this._rect(s, u, 4.2, 2.4);
      G.hexa([...Rs.map((p) => [p[0], top, p[1]]), ...Rs.map((p) => [p[0], top + 3.2, p[1]])], STEEL_C, { bottom: false });
      this._addCol(R0, pierTop, top + 3.2);
      legs.push(u);
      this._lightPos.push(ax.pt(s, u, top + 4.1));
    }
    const inner = (sg, y, frac) => {
      // inner face of a leg at height y (legs taper)
      const t = (y - pierTop) / (top - 9 - pierTop), half = LEG_ACROSS / 2 + (LEG_ACROSS_TOP / 2 - LEG_ACROSS / 2) * Math.max(0, Math.min(1, t));
      return c + sg * (lu - half * frac);
    };
    const strut = (y, h, depth) => {
      const p0 = ax.pt(s, inner(-1, y, 1), y), p1 = ax.pt(s, inner(1, y, 1), y);
      G.beam(p0, p1, depth, h, [a.dx, 0, a.dz], STEEL_C, false);
      this._addCol(this._rect(s, c, depth / 2, lu - 1), y - h / 2, y + h / 2);
    };
    const xpanel = (y0, y1) => {
      for (const sg of [-1, 1]) {
        const p0 = ax.pt(s, inner(-sg, y0, 0.6), y0), p1 = ax.pt(s, inner(sg, y1, 0.6), y1);
        // two parallel diagonals (front and back faces of the tower)
        for (const al of [-LEG_ALONG_TOP / 2 + 0.6, LEG_ALONG_TOP / 2 - 0.6]) {
          const o = [a.dx * al, 0, a.dz * al];
          G.beam([p0[0] + o[0], p0[1], p0[2] + o[2]], [p1[0] + o[0], p1[1], p1[2] + o[2]], 0.9, 1.3, [a.dx, 0, a.dz]);
        }
      }
    };
    // above the deck: 5 X-braced panels, then the portal
    const portal0 = top - 13, y0 = tTop + 5;
    if (portal0 - y0 > 25) {
      const N = 5, h = (portal0 - y0) / N;
      for (let k = 0; k < N; k++) {
        const ya = y0 + k * h, yb = ya + h;
        strut(ya, 1.8, 3.2);
        xpanel(ya + 0.9, yb - 0.9);
      }
    }
    // portal: deep girder + top cap
    strut(portal0 + 3.5, 7, LEG_ALONG_TOP - 0.4);
    {
      const R = this._rect(s, c, LEG_ALONG_TOP / 2 - 0.2, lu + LEG_ACROSS_TOP / 2);
      G.hexa([...R.map((p) => [p[0], top - 2.2, p[1]]), ...R.map((p) => [p[0], top, p[1]])], STEEL_C);
      this._addCol(R, top - 2.2, top);
    }
    // deck support strut directly under the truss + X panels below
    const ys = tBot - 1.6;
    if (ys - pierTop > 4) {
      strut(ys, 2.6, 4.5);
      const span = ys - 1.3 - (pierTop + 1);
      const N = Math.floor(span / 16);
      if (N >= 1) {
        const h = span / N;
        for (let k = 0; k < N; k++) {
          const ya = pierTop + 1 + k * h;
          if (k > 0) strut(ya, 1.6, 3.0);
          xpanel(ya + 0.8, ya + h - 0.8);
        }
      }
    }
  }

  // ================================================================ anchorages
  /** SF (dir=+1, cables leave towards +s) or Yerba Buena (dir=-1) anchorage. */
  _endAnchorage(s, dir) {
    const C = this.conc, ax = this.axis, c = this.trussC, lu = this.legU;
    const a = ax.at(s);
    const gnd = this.ground(a.x - a.dz * c, a.z + a.dx * c);
    const base = Math.min(gnd, this.isLand(a.x, a.z) ? gnd : this.W) - 3;
    const U = this.deckU(s), Lo = this.deckLo(s);
    const under = Math.min(U - 1.9, Number.isFinite(Lo) ? Lo - 1.9 : U - 1.9, this._nodeBot(s) - 0.3);
    // main mass below the decks
    if (under - gnd > 1.5) this._block(C, s, c, 26, lu + 6, base, under, CONC_DARK);
    else this._block(C, s, c, 26, lu + 6, base, gnd + 1.2, CONC_DARK);
    // cable housings flanking the truss, sloping up towards the span
    for (const sg of [-1, 1]) {
      const u = c + sg * (lu + 1.2);
      const yTop = U + 9, yLow = U + 3;
      const R = this._rect(s, u, 24, 3.6);
      // R[0],R[3] are at -along, R[1],R[2] at +along: higher on the span side
      const hiAt = (p, i) => [p[0], (dir > 0) === (i === 1 || i === 2) ? yTop : yLow, p[1]];
      C.hexa([...R.map((p) => [p[0], base, p[1]]), ...R.map((p, i) => hiAt(p, i))], CONC);
      this._addCol(R, base, yLow);
      this._addCol(this._rect(s + dir * 12, u, 12, 3.6), base, yTop);
      // steel cable bent (splay saddle) on top at the span end
      const e = ax.pt(s + dir * 16, u, U + 7);
      this.steel.beam([e[0], U + 2, e[2]], e, 2.2, 2.2, [a.dx, 0, a.dz]);
    }
    this._addCol(this._rect(s, c, 26, lu + 6), base, Math.max(gnd + 1.2, under));
  }

  _centralAnchorage(s) {
    const C = this.conc, ax = this.axis, c = this.trussC, lu = this.legU, W = this.W;
    const top = W + W4_TOP, tBot = this._nodeBot(s) - 1.5, U = this.deckU(s);
    // massive base block (~60 m x 30+ m) up to just under the truss
    this._block(C, s, c, 31, lu + 4.5, W - 4, W + 8, CONC_DARK);
    this._block(C, s, c, 29.5, lu + 3.5, W + 8, Math.max(W + 12, tBot), CONC, true, 0.08);
    // two tapering concrete pylons flanking the deck, joined by a cross block above the upper deck
    const pylBase = Math.max(W + 12, tBot);
    for (const sg of [-1, 1]) {
      const u = c + sg * (lu + 0.8);
      const R0 = this._rect(s, u, 26, 4.2), R1 = this._rect(s, u, 15, 3.6);
      C.hexa([...R0.map((p) => [p[0], pylBase, p[1]]), ...R1.map((p) => [p[0], top, p[1]])], CONC);
      this._addCol(this._rect(s, u, 20, 4.2), pylBase, top);
      this._lightPos.push(ax.pt(s - 14, u, top + 0.9), ax.pt(s + 14, u, top + 0.9));
      // cable entry saddles on both faces
      for (const d of [-1, 1]) { const e = ax.pt(s + d * 21, u, top - 5); this.steel.beam([e[0], top - 9, e[2]], e, 2.2, 2.2, [0, 0, 1]); }
    }
    const capY0 = Math.max(U + 14, top - 12);
    const Rc = this._rect(s, c, 15, lu + 4.4);
    C.hexa([...Rc.map((p) => [p[0], capY0, p[1]]), ...Rc.map((p) => [p[0], top, p[1]])], CONC);
    this._addCol(Rc, capY0, top);
  }

  _nodeBot(s) {
    const N = this._trussNodes; if (!N || !N.length) return this.deckU(s) - TRUSS_DEPTH;
    const i = Math.max(0, Math.min(N.length - 1, Math.round((s - N[0].s) / PANEL)));
    return N[i].bot;
  }

  /** Steel truss bents under the SF side span (between the anchorage and W2). */
  _bents(sA, sW2) {
    const ax = this.axis, G = this.steel, C = this.conc, c = this.trussC, T = this.trussT, r = this.world && this.world.raster;
    for (const f of [1 / 3, 2 / 3]) {
      let s = sA + (sW2 - sA) * f;
      for (const d of [0, 6, -6, 12, -12, 18, -18, 24, -24]) {
        let clear = true;
        for (const sg of [-1, 1]) { const p = ax.pt(s + d, c + sg * T, 0); if (r && r.any(p[0], p[2], 3, RBIT.ROAD)) clear = false; }
        if (clear) { s += d; break; }
      }
      const a = ax.at(s), bot = this._nodeBot(s) - 0.6;
      const legs = [];
      for (const sg of [-1, 1]) {
        const u = c + sg * (T - 0.2), p = ax.pt(s, u, 0);
        const g = Math.max(this.W, this.ground(p[0], p[2]));
        if (bot - g < 4) return;
        this._block(C, s, u, 2.6, 2.6, g - 2, g + 1.2, CONC_DARK);
        G.beam([p[0], g + 1.2, p[2]], [p[0], bot, p[2]], 2.0, 2.0, [a.dx, 0, a.dz]);
        this._addCol(this._rect(s, u, 1.1, 1.1), g, bot);
        legs.push({ u, g });
      }
      // X-bracing between the two legs, in panels of ~12 m
      const g = Math.max(legs[0].g, legs[1].g) + 1.2, H = bot - g, N = Math.max(1, Math.round(H / 12)), h = H / N;
      for (let k = 0; k < N; k++) {
        const y0 = g + k * h, y1 = y0 + h;
        const p0 = ax.pt(s, legs[0].u, y0), p1 = ax.pt(s, legs[1].u, y1), q0 = ax.pt(s, legs[1].u, y0), q1 = ax.pt(s, legs[0].u, y1);
        G.beam(p0, p1, 0.6, 0.6, [a.dx, 0, a.dz]); G.beam(q0, q1, 0.6, 0.6, [a.dx, 0, a.dz]);
        G.beam(q1, p1, 0.8, 0.9, [a.dx, 0, a.dz]);
      }
      // cap beam the truss sits on
      G.beam(ax.pt(s, c - T - 1, bot + 0.6), ax.pt(s, c + T + 1, bot + 0.6), 2.0, 1.2, [a.dx, 0, a.dz]);
    }
  }

  // ================================================================ cables
  _cableSpan(s0, y0, s1, y1, sag) {
    const ax = this.axis, G = this.steel, c = this.trussC, lu = this.legU;
    const len = s1 - s0, segs = Math.max(8, Math.ceil(len / 9));
    const yAt = (s) => { const t = (s - s0) / len; return y0 + (y1 - y0) * t - 4 * sag * t * (1 - t); };
    for (const sg of [-1, 1]) {
      const u = c + sg * lu;
      const pts = [];
      for (let i = 0; i <= segs; i++) { const s = s0 + (len * i) / segs; pts.push(ax.pt(s, u, yAt(s) + CABLE_R)); }
      G.tube(pts, CABLE_R, 8, CABLE_C);
      // suspenders every 15 m, hanging to the top chord via a short outrigger bracket
      const first = Math.ceil((s0 + 8) / SUSP_SPACING) * SUSP_SPACING;
      const d = ax.at((s0 + s1) / 2), hint = [d.dx, 0, d.dz];
      for (let s = first; s < s1 - 8; s += SUSP_SPACING) {
        const yc = yAt(s), yb = this.deckU(s) - 0.45 + 0.6;
        if (yc - yb < 1.5) continue;
        const p = ax.pt(s, u, yb), q = ax.pt(s, u, yc);
        G.beam(p, q, 0.28, 0.28, hint, ROPE_C);
        const k = ax.pt(s, c + sg * this.trussT, yb - 0.3);
        G.beam(k, [p[0], yb - 0.3, p[2]], 0.5, 0.6, hint);
        G.beam(ax.pt(s, u, yc - 0.7), ax.pt(s, u, yc + 2 * CABLE_R + 0.2), 1.0, 0.9, [-d.dz * sg, 0, d.dx * sg]); // cable band
      }
    }
  }

  // ================================================================ deck details
  /**
   * Steel railings on top of both decks' concrete barriers, the floor system (floor beams + stringers) under
   * the upper deck (the lower deck's ceiling) and under the lower deck, and ceiling lamps over the lower deck.
   */
  _deckDetails() {
    const ax = this.axis, G = this.steel, c = this.trussC, T = this.trussT, N = this._trussNodes || [];
    const eU = T - 0.62; // barrier centre line from the truss centre
    for (let i = 0; i + 1 < N.length; i++) {
      const n = N[i], m = N[i + 1];
      if (!n.ok || !m.ok) continue;
      const d = ax.at(n.s), hint = [d.dx, 0, d.dz];
      const decks = [];
      const U0 = this.deckU(n.s), U1 = this.deckU(m.s), L0 = this.deckLo(n.s), L1 = this.deckLo(m.s);
      decks.push([U0, U1, 'U']);
      const both = Number.isFinite(L0) && Number.isFinite(L1) && U0 - L0 > 6;
      if (both) decks.push([L0, L1, 'L']);
      for (const [h0, h1] of decks) {
        for (const sg of [-1, 1]) {
          const u = c + sg * eU, side = [-d.dz * sg, 0, d.dx * sg];
          // two rails above the 0.95 m barrier, posts every 2.5 m
          for (const y of [1.22, 1.5]) G.beam(ax.pt(n.s, u, h0 + y - 0.05), ax.pt(m.s, u, h1 + y - 0.05), 0.07, 0.09, side, RAIL_C);
          for (let k = 0; k < 4; k++) { const s = n.s + (m.s - n.s) * (k / 4), h = h0 + (h1 - h0) * (k / 4); G.beam(ax.pt(s, u, h + 0.88), ax.pt(s, u, h + 1.55), 0.08, 0.08, hint, RAIL_C); }
        }
      }
      // floor system under the upper deck (seen from the lower deck) and under the lower deck (seen from the water)
      const under = [];
      if (both) under.push([U0 - 1.6, U1 - 1.6, true]);
      if (Number.isFinite(L0) && Number.isFinite(L1)) under.push([L0 - 1.6, L1 - 1.6, false]);
      for (const [y0, y1, ceil] of under) {
        for (const f of [0, 0.5]) { // floor beams every 5 m
          const s = n.s + (m.s - n.s) * f, y = y0 + (y1 - y0) * f;
          G.beam(ax.pt(s, c - T + 0.7, y - 0.45), ax.pt(s, c + T - 0.7, y - 0.45), 0.35, 0.85, hint, STEEL_C);
        }
        for (let k = -2; k <= 2; k++) { // stringers
          const u = c + k * (T - 1.2) / 2.2;
          G.beam(ax.pt(n.s, u, y0 - 0.3), ax.pt(m.s, u, y1 - 0.3), 0.28, 0.55, [-d.dz, 0, d.dx], STEEL_C);
        }
        if (ceil && i % 2 === 0) for (const sg of [-1, 1]) { const p = ax.pt(n.s + 5, c + sg * (T - 2.4), y0 - 1.05); this._lampPos.push(p); }
      }
    }
  }
  /** Lower-deck ceiling lamps (instanced, lit at night); also feed the props' nearest-lamp point lights. */
  _buildDeckLamps(group) {
    const P = this._lampPos || [];
    if (!P.length) return;
    const geo = new THREE.BoxGeometry(0.9, 0.12, 0.35);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.22, 0.16) });
    const im = new THREE.InstancedMesh(geo, mat, P.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    P.forEach((p, i) => {
      const [s] = this.axis.project(p[0], p[2]); const a = this.axis.at(s);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-a.dz, a.dx));
      m.compose(new THREE.Vector3(p[0], p[1], p[2]), q, one); im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    im.name = 'bay-bridge-deck-lamps';
    this.deckLamps = im;
    group.add(im);
    const props = this.world && this.world.props;
    if (props && Array.isArray(props.lampHeads)) for (const p of P) props.lampHeads.push([p[0], p[1] - 0.2, p[2]]);
    this.stats.deckLamps = P.length;
  }

  // ================================================================ lights
  _buildLights(group) {
    const P = this._lightPos; if (!P.length) return;
    const geo = new THREE.SphereGeometry(1.4, 10, 6);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.016, 0.01), fog: false }); // beacons cut through the haze
    const im = new THREE.InstancedMesh(geo, mat, P.length);
    const m = new THREE.Matrix4();
    P.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, m); });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.name = 'bay-bridge-warning-lights';
    im.frustumCulled = false;
    this.lights = im;
    group.add(im);
  }

  // ================================================================ clean-up of other modules' generic stand-ins
  /** RoadNetwork.js gives every elevated deck concrete columns every ~70 m; a suspension span has none.
   *  Collapse those column (and cross-beam) triangles inside the suspended spans and disable their colliders. */
  _clearRoadPiers(sMin, sMax) {
    if (!(sMax > sMin)) return;
    const ax = this.axis, c = this.trussC, wide = this.trussT + 5;
    // a quick corridor test: bbox + projection
    const xs = [], zs = [];
    for (let s = sMin; s <= sMax; s += 50) { const p = ax.pt(s, c, 0); xs.push(p[0]); zs.push(p[2]); }
    const bb = { minX: Math.min(...xs) - wide - 5, maxX: Math.max(...xs) + wide + 5, minZ: Math.min(...zs) - wide - 5, maxZ: Math.max(...zs) + wide + 5 };
    const inCorr = (x, z) => {
      if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) return null;
      const [s, u] = ax.project(x, z);
      if (s < sMin || s > sMax || Math.abs(u - c) > wide) return null;
      return s;
    };
    // deck heights at s: candidate surfaces a column can belong to
    const decksAt = (s) => { const U = this.deckU(s), Lo = this.deckLo(s); return Number.isFinite(Lo) ? [Lo, U] : [U]; };
    // 1) colliders: small columns whose top is just under a deck
    let nc = 0;
    if (this.net && Array.isArray(this.net.piers) && this.colliders && this.colliders.boxes) {
      const boxes = this.colliders.boxes;
      for (let bi = 0; bi < Math.min(boxes.length, this._colStart); bi++) {
        const b = boxes[bi];
        if (b.kind !== COL_KIND || b.maxX - b.minX > 7 || b.maxZ - b.minZ > 7) continue;
        const s = inCorr((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2); if (s === null) continue;
        if (b.minY > Math.min(...decksAt(s)) - 5) continue; // deck slab boxes stay
        b.minY = -10001; b.maxY = -10000; nc++;
      }
    }
    // 2) geometry: triangles of the RoadNetwork.js structure mesh
    let nt = 0;
    const mesh = this.world && this.world.group && this.world.group.children.find((m) => m.isMesh && /sidewalks|structures/.test(m.name || ''));
    const g = mesh && mesh.geometry;
    if (g && g.index && g.attributes.position) {
      const P = g.attributes.position.array, I = g.index.array;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t], b = I[t + 1], d = I[t + 2];
        if (a === b) continue;
        const cx = (P[a * 3] + P[b * 3] + P[d * 3]) / 3, cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[d * 3 + 2]) / 3;
        const s = inCorr(cx, cz); if (s === null) continue;
        const ys = [P[a * 3 + 1], P[b * 3 + 1], P[d * 3 + 1]], ymin = Math.min(...ys), ymax = Math.max(...ys);
        // along-axis extent: columns / cross beams are short, deck faces span a full 18 m subdivision
        const sa = ax.project(P[a * 3], P[a * 3 + 2])[0], sb = ax.project(P[b * 3], P[b * 3 + 2])[0], sd = ax.project(P[d * 3], P[d * 3 + 2])[0];
        if (Math.max(sa, sb, sd) - Math.min(sa, sb, sd) > 4.5) continue;
        const above = decksAt(s).filter((h) => h >= ymax + 1.0);
        if (!above.length) continue;
        if (ymin >= Math.min(...above) - 1.9) continue; // the deck's own underside / edge faces
        I[t + 1] = a; I[t + 2] = a; nt++;
      }
      if (nt) g.index.needsUpdate = true;
    }
    this.stats.clearedPierColliders = nc; this.stats.clearedPierTris = nt;
  }

  /** OSM maps W2 as a 160 m `building=tower` box; the buildings module renders it as a solid block. */
  _hideOsmTowers(towerS) {
    const ax = this.axis, foot = [];
    for (const b of (this.data && this.data.buildings) || []) {
      if (!b || !Array.isArray(b.p) || b.p.length < 3 || b.lod || !((b.h || 0) > 90)) continue;
      let cx = 0, cz = 0; for (const q of b.p) { cx += q[0]; cz += q[1]; } cx /= b.p.length; cz /= b.p.length;
      const [s, u] = ax.project(cx, cz);
      if (Math.abs(u) < 35 && towerS.some((t) => Math.abs(t - s) < 30)) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const q of b.p) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]); }
        foot.push({ ring: b.p, cx, cz, minX: minX - 0.6, maxX: maxX + 0.6, minZ: minZ - 0.6, maxZ: maxZ + 0.6, h: b.h });
      }
    }
    if (!foot.length) return;
    const inside = (f, x, z) => {
      if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) return false;
      // expanded point-in-polygon: inside or within 0.6 m of the outline
      let c = false; const r = f.ring;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if ((r[i][1] > z) !== (r[j][1] > z) && x < ((r[j][0] - r[i][0]) * (z - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      }
      if (c) return true;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const ax2 = r[j][0], az = r[j][1], dx = r[i][0] - ax2, dz = r[i][1] - az, L2 = dx * dx + dz * dz || 1;
        let t = ((x - ax2) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
        if (Math.hypot(x - ax2 - dx * t, z - az - dz * t) < 0.6) return true;
      }
      return false;
    };
    let nv = 0;
    for (const m of (this.world && this.world.group && this.world.group.children) || []) {
      if (!m.isMesh || m.name !== 'buildings') continue;
      const pa = m.geometry.attributes.position, P = pa.array;
      const bbx = m.geometry.boundingBox;
      if (bbx && !foot.some((f) => f.maxX >= bbx.min.x && f.minX <= bbx.max.x && f.maxZ >= bbx.min.z && f.minZ <= bbx.max.z)) continue;
      let hit = 0;
      for (let i = 0; i < P.length; i += 3) {
        for (const f of foot) if (inside(f, P[i], P[i + 2])) { P[i] = f.cx; P[i + 1] = -80; P[i + 2] = f.cz; hit++; break; }
      }
      if (hit) { pa.needsUpdate = true; nv += hit; }
    }
    let nc = 0;
    if (this.colliders && this.colliders.boxes) {
      for (const b of this.colliders.boxes) {
        if (b.kind !== 1) continue;
        const x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
        if (foot.some((f) => inside(f, x, z))) { b.minY = -10001; b.maxY = -10000; nc++; }
      }
    }
    this.stats.hiddenOsmTowerVerts = nv; this.stats.hiddenOsmTowerColliders = nc;
  }
}

/**
 * MapWorld plugin (engine/src/world/MapWorld.js): builds the superstructure after the street furniture
 * (world.bridge = the BayBridge instance) and hands its 3 km steel mesh to the final tiling pass (`chunk` m pieces).
 */
export function bayBridgePlugin({ chunk = 400 } = {}) {
  return {
    name: 'bridge', label: 'Bay Bridge', instance: null,
    afterProps(ctx) { this.instance = new BayBridge(ctx); return this.instance.build(); },
    update(dt, cameraPos, darkness) { this.instance.update(dt, cameraPos, darkness); },
    chunk() {
      const g = this.instance && this.instance.group;
      const steel = g && g.children.find((m) => m.name === 'bay-bridge-steel');
      return steel && chunk ? [{ mesh: steel, cell: chunk }] : [];
    },
  };
}

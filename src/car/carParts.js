// Hero-car parts: 21" turbine wheels with brakes, interior (seats, dash, screen, yoke, door cards),
// thruster nozzles, mirrors, spoiler blade, splitter, diffuser fins, side skirts.
import * as THREE from 'three';
import {
  WR, ZC0, ZBULK, RIM_IN, section, bodyStations, loftMirrored, orient, YB, shear, sstep,
} from './carBody.js';

const V2 = (x, y) => new THREE.Vector2(x, y);

export function mesh(geo, mat, shadow = true, receive = shadow) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = receive;
  return m;
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Box-projected UVs in metres (for carbon weave on arbitrary geometry). */
export function boxUV(geo, scale = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------------------------------------
// wheels
// ---------------------------------------------------------------------------------------------
/** Geometries for one tyre width (shared by the two wheels of an axle; left side is mirrored). */
export function wheelGeometries(width) {
  const R = WR, hw = width / 2, RB = 0.267;   // 21" bead seat radius = 0.2667 m
  // tyre: lathe of the section (inner bead -> sidewall -> tread with grooves -> outer bead)
  const side = [[RB, 0.016], [0.277, 0.001], [0.293, -0.004], [0.313, -0.004], [0.328, 0.0], [0.339, 0.008], [0.3465, 0.02], [0.35, 0.036]];
  const prof = [];
  for (const [r, ins] of side) prof.push(V2(r, -hw + ins));
  for (const f of [-0.24, 0, 0.24]) {
    const g = f * width;
    prof.push(V2(R, g - 0.009), V2(R - 0.0075, g - 0.006), V2(R - 0.0075, g + 0.006), V2(R, g + 0.009));
  }
  for (const [r, ins] of side.slice().reverse()) prof.push(V2(r, hw - ins));
  const tyre = new THREE.LatheGeometry(prof, 48);
  tyre.rotateZ(-Math.PI / 2);

  // rim lip (polished flange) and dark barrel
  const lip = new THREE.LatheGeometry([V2(0.249, hw - 0.052), V2(0.258, hw - 0.034), V2(0.268, hw - 0.022), V2(0.2705, hw - 0.013), V2(0.266, hw - 0.009), V2(RB - 0.001, hw - 0.012)], 48);
  lip.rotateZ(-Math.PI / 2);
  const barrel = new THREE.CylinderGeometry(0.25, 0.25, width - 0.05, 36, 1, true);
  barrel.rotateZ(Math.PI / 2);

  // turbine face: disc with 10 swept blade-shaped windows, beveled, dished toward the hub
  const NB = 10, rO = 0.252, rOut = 0.232, rIn = 0.086, sweep = 0.62, bw = 0.0165;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rO, 0, Math.PI * 2, false);
  const ang = (r, k) => (k * 2 * Math.PI) / NB + sweep * Math.pow((r - rIn) / (rOut - rIn), 1.15);
  for (let k = 0; k < NB; k++) {
    const pts = [];
    const span = (2 * Math.PI) / NB;
    for (let i = 0; i <= 3; i++) { const a = ang(rOut, k) + bw / rOut + (span - (2 * bw) / rOut) * (i / 3); pts.push(V2(Math.cos(a) * rOut, Math.sin(a) * rOut)); }
    for (let i = 1; i <= 5; i++) { const r = rOut - (rOut - rIn) * (i / 5), a = ang(r, k) + span - bw / r; pts.push(V2(Math.cos(a) * r, Math.sin(a) * r)); }
    for (let i = 1; i <= 2; i++) { const a = ang(rIn, k) + span - bw / rIn - (span - (2 * bw) / rIn) * (i / 3); pts.push(V2(Math.cos(a) * rIn, Math.sin(a) * rIn)); }
    for (let i = 0; i <= 4; i++) { const r = rIn + (rOut - rIn) * (i / 5), a = ang(r, k) + bw / r; pts.push(V2(Math.cos(a) * r, Math.sin(a) * r)); }
    shape.holes.push(new THREE.Path(pts));
  }
  const face = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.0045, bevelSegments: 1, curveSegments: 40 });
  {
    const p = face.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i));
      p.setZ(i, p.getZ(i) - 0.034 * Math.pow(Math.max(0, 1 - r / rO), 1.25));
    }
    face.computeVertexNormals();
  }
  face.rotateY(Math.PI / 2);                       // extrusion -> +X (outboard)
  face.translate(hw - 0.046, 0, 0);
  const cap = new THREE.CylinderGeometry(0.046, 0.052, 0.024, 24);
  cap.rotateZ(Math.PI / 2);
  cap.translate(hw - 0.072, 0, 0);

  // brake disc (drilled face texture), hat, caliper
  const discF = new THREE.RingGeometry(0.112, 0.198, 40, 1);
  discF.rotateY(Math.PI / 2); discF.translate(0.016 - 0.01, 0, 0);
  const discB = new THREE.RingGeometry(0.112, 0.198, 40, 1);
  discB.rotateY(-Math.PI / 2); discB.translate(-0.016 - 0.01, 0, 0);
  const discE = new THREE.CylinderGeometry(0.198, 0.198, 0.032, 40, 1, true);
  discE.rotateZ(Math.PI / 2); discE.translate(-0.01, 0, 0);
  const hat = new THREE.CylinderGeometry(0.112, 0.112, 0.06, 24);
  hat.rotateZ(Math.PI / 2); hat.translate(0.02, 0, 0);
  const cs = new THREE.Shape();
  const a0 = (145 - 30) * Math.PI / 180, a1 = (145 + 30) * Math.PI / 180;
  cs.absarc(0, 0, 0.238, a0, a1, false);
  cs.absarc(0, 0, 0.166, a1, a0, true);
  const caliper = new THREE.ExtrudeGeometry(cs, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 });
  caliper.rotateY(Math.PI / 2);
  caliper.translate(-0.045, 0, 0);
  return { tyre, lip, barrel, face, cap, discF, discB, discE, hat, caliper, width };
}

/** pivot (steer) -> spin (roll) -> visual (mirrored for the left side). Calipers do not spin. */
export function buildWheel(geos, mats, side) {
  const pivot = new THREE.Group(), spin = new THREE.Group(), vis = new THREE.Group(), fixed = new THREE.Group();
  pivot.add(spin, fixed); spin.add(vis);
  vis.scale.x = side; fixed.scale.x = side;
  vis.add(mesh(geos.tyre, mats.tyre));
  vis.add(mesh(geos.lip, mats.rim, false, true));
  vis.add(mesh(geos.barrel, mats.rimDark, false, true));
  vis.add(mesh(geos.face, mats.rim, true, true));
  vis.add(mesh(geos.cap, mats.satin, false, true));
  vis.add(mesh(geos.discF, mats.disc, false, true));
  vis.add(mesh(geos.discB, mats.disc, false, true));
  vis.add(mesh(geos.discE, mats.disc, false, true));
  vis.add(mesh(geos.hat, mats.discHat, false, true));
  fixed.add(mesh(geos.caliper, mats.caliper, false, true));
  return { pivot, spin };
}

// ---------------------------------------------------------------------------------------------
// thruster nozzle: exit plane at the origin, plume along local -Y
// ---------------------------------------------------------------------------------------------
const _nozzleCache = new Map();
export function buildNozzle(re, mats) {
  let g = _nozzleCache.get(re);
  if (!g) {
    const L = re * 1.6;
    const outer = new THREE.LatheGeometry([V2(re * 1.14, -0.002), V2(re * 1.08, 0.01), V2(re * 0.86, L * 0.5), V2(re * 0.52, L)], 16);
    const inner = new THREE.LatheGeometry([V2(re, -0.001), V2(re * 0.72, L * 0.45), V2(re * 0.4, L * 0.92)], 16);
    const throat = new THREE.CircleGeometry(re * 0.42, 16);
    throat.rotateX(Math.PI / 2); throat.translate(0, L * 0.9, 0);
    g = { outer, inner, throat };
    _nozzleCache.set(re, g);
  }
  const grp = new THREE.Group();
  grp.add(mesh(g.outer, mats.nozzle, false, true));
  grp.add(mesh(g.inner, mats.nozzleIn, false, false));
  grp.add(mesh(g.throat, mats.nozzleIn, false, false));
  return grp;
}

// ---------------------------------------------------------------------------------------------
// interior
// ---------------------------------------------------------------------------------------------
function profileExtrude(pts, halfWidth, bevel = 0.008) {
  const s = new THREE.Shape(pts.map(([z, y]) => V2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: halfWidth * 2 - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.rotateY(-Math.PI / 2);                 // shape x -> car z, extrusion -> car -x
  g.translate(halfWidth - bevel, 0, 0);
  return g;
}

function seatParts(mats) {
  const grp = new THREE.Group();
  // cushion
  const cushion = new THREE.ExtrudeGeometry(roundedRect(0.38, 0.44, 0.07), { depth: 0.05, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 4 });
  cushion.rotateX(-Math.PI / 2);
  const cm = mesh(cushion, mats.leather); cm.position.set(0, 0.07, 0.11); cm.rotation.x = -0.09; grp.add(cm);
  // backrest with integrated headrest
  const bs = new THREE.Shape();
  bs.moveTo(-0.2, 0); bs.lineTo(0.2, 0); bs.quadraticCurveTo(0.225, 0.2, 0.215, 0.38);
  bs.quadraticCurveTo(0.2, 0.47, 0.12, 0.49); bs.lineTo(0.115, 0.6); bs.quadraticCurveTo(0.11, 0.69, 0, 0.69);
  bs.quadraticCurveTo(-0.11, 0.69, -0.115, 0.6); bs.lineTo(-0.12, 0.49); bs.quadraticCurveTo(-0.2, 0.47, -0.215, 0.38);
  bs.quadraticCurveTo(-0.225, 0.2, -0.2, 0);
  const back = new THREE.ExtrudeGeometry(bs, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.022, bevelSegments: 2, curveSegments: 5 });
  back.translate(0, 0, -0.025);
  const bk = new THREE.Group(); bk.position.set(0, 0.13, 0.36); bk.rotation.x = 0.36; grp.add(bk);
  bk.add(mesh(back, mats.leather));
  // dark side bolsters (back + cushion) and a headrest slot
  const bol = new THREE.ExtrudeGeometry(roundedRect(0.06, 0.42, 0.028), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.016, bevelSegments: 1, curveSegments: 3 });
  for (const sx of [-1, 1]) {
    const b = mesh(bol, mats.leatherDark); b.position.set(sx * 0.2, 0.23, -0.07); b.rotation.y = -sx * 0.25; bk.add(b);
    const c = mesh(bol, mats.leatherDark); c.rotation.x = -Math.PI / 2; c.position.set(sx * 0.2, 0.11, 0.1); c.rotation.z = sx * 0.12; grp.add(c);
  }
  const slot = mesh(new THREE.ExtrudeGeometry(roundedRect(0.12, 0.035, 0.016), { depth: 0.002, bevelEnabled: false }), mats.leatherDark, false);
  slot.position.set(0, 0.53, 0.058); bk.add(slot);
  return grp;
}

function yokeParts(mats) {
  const mount = new THREE.Group();
  const yoke = new THREE.Group();
  mount.add(yoke);
  const yp = [[-0.152, 0.048], [-0.166, -0.008], [-0.152, -0.06], [-0.1, -0.086], [0, -0.092], [0.1, -0.086], [0.152, -0.06],
    [0.166, -0.008], [0.152, 0.048], [0.118, 0.062], [0.06, 0.04], [0, 0.034], [-0.06, 0.04], [-0.118, 0.062]];
  const crv = new THREE.CatmullRomCurve3(yp.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal');
  yoke.add(mesh(new THREE.TubeGeometry(crv, 60, 0.0165, 7, true), mats.leatherDark, false, true));
  const hub = new THREE.ExtrudeGeometry(roundedRect(0.11, 0.072, 0.022), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 4 });
  const hm = mesh(hub, mats.trim, false, true); hm.position.z = -0.02; yoke.add(hm);
  for (const sx of [-1, 1]) {
    const sp = mesh(new THREE.BoxGeometry(0.1, 0.024, 0.016), mats.satin, false, true);
    sp.position.set(sx * 0.105, -0.012, -0.004); yoke.add(sp);
  }
  const col = new THREE.CylinderGeometry(0.028, 0.034, 0.24, 14, 1, true);
  col.rotateX(Math.PI / 2); col.translate(0, 0, -0.14);
  mount.add(mesh(col, mats.interior, false, true));
  return { mount, yoke };
}

/** Cockpit: door cards + floor (loft from the rim), firewall, bulkhead, dash, console, screens, yoke, seats. */
export function buildInterior(mats) {
  const grp = new THREE.Group();
  grp.name = 'interior';
  const zs = bodyStations().filter((z) => z >= ZC0 - 1e-6 && z <= ZBULK + 1e-6);
  const NL = 9;
  const rows = zs.map((z) => {
    const s = section(z), xr = s.xr, yr = s.yr;
    const pts = [[xr, yr], [xr - 0.022, yr + 0.004], [xr - 0.045, yr - 0.02], [xr - 0.055, yr - 0.09], [xr - 0.06, 0.52],
      [xr - 0.07, 0.34], [xr - 0.075, 0.23], [xr - 0.06, 0.2], [0, 0.2]];
    const P = new Float32Array(NL * 3);
    pts.forEach(([x, y], k) => { P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z; });
    return { z, P };
  });
  const lining = loftMirrored(rows, 'P', NL, (r, k) => {
    const z = (rows[r].z + rows[r + 1].z) / 2;
    if (k === NL - 2 || k === NL - 3) return 2;           // carpet floor
    if ((k === 3 || k === 4) && z > -0.52 && z < 0.46) return 1; // leather door-card insert
    return 0;
  }, 3, (row, k, A) => [row.z * 2, A[k * 3 + 1] * 2]);
  orient(lining, (c, e) => e.set(-Math.sign(c.x), c.y < 0.25 ? 1 : 0, 0));
  const lm = new THREE.Mesh(lining, [mats.interior, mats.leather, mats.carpet]);
  lm.receiveShadow = true; grp.add(lm);
  // armrest / door pull
  for (const sx of [-1, 1]) {
    const s0 = section(-0.35);
    const pull = new THREE.CapsuleGeometry(0.018, 0.5, 4, 8);
    pull.rotateX(Math.PI / 2);
    const pm = mesh(pull, mats.leatherDark, false, true);
    pm.position.set(sx * (s0.xr - 0.085), 0.55, -0.12); grp.add(pm);
  }
  // firewall + bulkhead following the deck surface
  for (const [z, face] of [[ZC0 + 0.002, 1], [ZBULK - 0.002, -1]]) {
    const s = section(z), sh = new THREE.Shape();
    sh.moveTo(-s.xr, 0.2); sh.lineTo(s.xr, 0.2);
    for (let i = 0; i <= 16; i++) { const x = s.xr * (1 - (2 * i) / 16); sh.lineTo(x, s.topY(Math.abs(x)) - 0.004); }
    const g = new THREE.ShapeGeometry(sh, 4);
    if (face < 0) g.rotateY(Math.PI);
    const m = mesh(g, mats.interior, false, true); m.position.z = z; grp.add(m);
  }
  // dash
  const dashW = section(-0.55).xr - 0.06;
  const dash = profileExtrude([[ZC0 + 0.004, 0.2], [ZC0 + 0.004, 0.7], [-0.66, 0.762], [-0.56, 0.784], [-0.48, 0.786], [-0.43, 0.772],
    [-0.405, 0.735], [-0.41, 0.66], [-0.45, 0.58], [-0.55, 0.5], [-0.6, 0.42], [-0.6, 0.2]], dashW, 0.01);
  {
    const p = dash.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.68) p.setY(i, p.getY(i) - 0.04 * Math.pow(Math.abs(p.getX(i)) / dashW, 2));
    dash.computeVertexNormals();
  }
  grp.add(mesh(dash, mats.interior, false, true));
  // ambient light line along the dash face
  const amb = mesh(new THREE.BoxGeometry(dashW * 1.7, 0.003, 0.003), mats.ambient, false, false);
  amb.position.set(0, 0.74, -0.408); grp.add(amb);
  // centre console
  grp.add(mesh(profileExtrude([[-0.47, 0.2], [-0.47, 0.56], [-0.4, 0.52], [-0.1, 0.45], [0.3, 0.43], [0.36, 0.4], [0.36, 0.2]], 0.085, 0.012), mats.interior, false, true));
  const ctop = mesh(new THREE.BoxGeometry(0.15, 0.006, 0.34), mats.trim, false, true);
  ctop.position.set(0, 0.44, 0.05); ctop.rotation.x = 0.06; grp.add(ctop);
  // centre landscape touchscreen
  {
    const s = new THREE.Group();
    s.position.set(-0.03, 0.858, -0.45); s.rotation.set(-0.3, -0.16, 0, 'YXZ');
    const bez = mesh(new THREE.ExtrudeGeometry(roundedRect(0.29, 0.166, 0.012), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 3 }), mats.trim, false, true);
    bez.position.z = -0.013; s.add(bez);
    const scr = mesh(new THREE.PlaneGeometry(0.272, 0.15), mats.screen, false, false);
    scr.position.z = 0.0006; s.add(scr);
    const stalk = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), mats.trim, false, false);
    stalk.position.set(0, -0.07, -0.03); s.add(stalk);
    grp.add(s);
  }
  // driver display behind the yoke
  {
    const s = new THREE.Group();
    s.position.set(-0.35, 0.795, -0.53); s.rotation.x = -0.28;
    const bez = mesh(new THREE.BoxGeometry(0.17, 0.062, 0.012), mats.trim, false, false); bez.position.z = -0.007; s.add(bez);
    s.add(mesh(new THREE.PlaneGeometry(0.155, 0.05), mats.cluster, false, false));
    grp.add(s);
  }
  // yoke
  const { mount, yoke } = yokeParts(mats);
  mount.position.set(-0.35, 0.685, -0.3); mount.rotation.x = -0.42; mount.scale.setScalar(0.9);
  grp.add(mount);
  // seats
  for (const sx of [-1, 1]) {
    const seat = seatParts(mats);
    seat.position.set(sx * 0.35, 0.2, 0);
    grp.add(seat);
  }
  return { group: grp, yoke };
}

// ---------------------------------------------------------------------------------------------
// exterior add-ons
// ---------------------------------------------------------------------------------------------
export function buildMirror(mats) {
  const grp = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 9; i++) { const t = i / 9; prof.push(V2(0.056 * Math.pow(Math.sin((Math.PI / 2) * t), 0.62), 0.085 * t)); }
  prof.push(V2(0.05, 0.086));
  const h = new THREE.LatheGeometry(prof, 22);
  h.rotateX(Math.PI / 2);
  const hm = mesh(boxUV(h, 1), mats.carbon); hm.scale.set(1.6, 0.78, 1); grp.add(hm);
  const gl = mesh(new THREE.CircleGeometry(0.05, 22), mats.mirror, false); gl.scale.set(1.6, 0.78, 1); gl.position.z = 0.0855; grp.add(gl);
  return grp;
}

/** Ducktail blade resting on the deck: chord from zLE to zTE, follows the deck curvature. Hinge at the LE. */
export function buildSpoilerBlade(zLE, zTE, halfW) {
  const NX = 18, NC = 12;
  const sLE = section(zLE), hy = sLE.topY(0);
  const rows = [];
  for (let i = 0; i <= NX; i++) {
    const x = halfW * (i / NX);
    const P = new Float32Array(NC * 3);
    for (let k = 0; k < NC; k++) {
      // closed airfoil loop: bottom LE -> TE -> top TE -> LE
      const a = (k / (NC - 1)) * Math.PI * 2;
      const t = 0.5 - 0.5 * Math.cos(a);       // chord fraction 0..1..0
      const top = a > Math.PI;
      const z = zLE + (zTE - zLE) * t;
      const sd = section(z).topY(Math.min(x, section(z).xc));
      const th = top ? 0.0155 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.7) + 0.003 : 0.001;
      const tip = 1 - Math.pow(i / NX, 6) * 0.6;
      P[k * 3] = x; P[k * 3 + 1] = sd + 0.004 + th * tip - hy; P[k * 3 + 2] = z - zLE;
    }
    rows.push({ P, z: x });
  }
  // rows run along x here: swap roles so loftMirrored mirrors x correctly (rows are x stations)
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  for (const sg of [1, -1]) {
    const base = pos.length / 3;
    for (const r of rows) for (let k = 0; k < NC; k++) pos.push(sg * r.P[k * 3], r.P[k * 3 + 1], r.P[k * 3 + 2]);
    for (let i = 0; i < NX; i++) for (let k = 0; k < NC - 1; k++) {
      const a = base + i * NC + k, b = a + 1, c = a + NC, d = c + 1;
      if (sg > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  orient(g, (c, e) => e.set(0, c.y > 0.008 ? 1 : -1, 0));
  g.computeVertexNormals();
  return { geo: g, hingeY: hy };
}

/** Carbon side skirt following the rocker between the arches. */
export function buildSkirt(z0, z1) {
  const rows = [];
  const n = 36;
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n, s = section(z), w = s.w, b = s.b;
    const pts = [[w - 0.07, b + 0.001], [w + 0.006, b - 0.004], [w + 0.017, b + 0.01], [w + 0.01, b + 0.03], [w - 0.026, b + 0.046]];
    const P = new Float32Array(15);
    pts.forEach(([x, y], k) => { P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z; });
    rows.push({ z, P });
  }
  const g = loftMirrored(rows, 'P', 5, null, 1, (row, k, A) => [row.z, A[k * 3 + 1] + A[k * 3] * 0.3]);
  orient(g, (c, e) => e.set(Math.sign(c.x), -0.3, 0));
  return g;
}

/** Diffuser strake profile (z, y) following the kicked-up, sheared tail floor. */
export function buildDiffuserFin(thick) {
  const pts = [];
  pts.push([1.78, 0.137]);
  for (let i = 0; i <= 10; i++) {
    const z = 1.8 + (2.225 - 1.8) * (i / 10), b = YB(z), f = 0.866;
    pts.push([z + shear(z, b, b, f), b - 0.002]);
  }
  pts.push([2.245, 0.298], [2.262, 0.282], [2.252, 0.185], [2.17, 0.168], [1.86, 0.139]);
  return profileExtrude(pts, thick / 2, 0.003);
}

export { roundedRect, profileExtrude, sstep };

// Procedural hero car — Tesla Roadster (2nd gen) proportions with the SpaceX cold-gas package.
// 4.6 m long, 2.0 m wide (body), 1.13 m tall, 2.8 m wheelbase, 21" turbine wheels.
// Local frame: forward -Z, right +X, up +Y; tyre contact patch at y = 0.
// No external assets. The geometry builds in Node too (canvas textures are skipped there).
import * as THREE from 'three';
import { SPEC, WHEEL_LOCAL, THRUSTER } from './Physics.js';
import {
  WR, ZC0, ZC1, I_RIM, YB, HW, BELT, CANOPY_TH_EDGE, buildBodyGeometry, buildCanopyGeometry, bodyPoint, uAtY, uAtX,
  canopyPoint, canopyNormal, ribbonGeometry, patchGeometry, SurfaceProjector, dentCentre, section, clamp,
} from './carBody.js';
import { createMaterials } from './carMaterials.js';
import {
  mesh, boxUV, wheelGeometries, buildWheel, buildNozzle, buildInterior, buildMirror, buildSpoilerBlade, buildSkirt, buildDiffuserFin,
} from './carParts.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---- surface sampling helpers ---------------------------------------------------------------
function bodySample(z, u, side) {
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  bodyPoint(z, u, side, p, n);
  return { p, n };
}
function canopySample(z, th, side) {
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  canopyPoint(z, th, side, p); canopyNormal(z, th, side, n);
  return { p, n };
}
function projSampler(proj, dir, zStart, tilt) {
  let last = null;
  return (x, y) => {
    // (x, y) is where the ray passes at the reference plane z = zRef (tilted rays drop as they travel)
    const o = new THREE.Vector3(x, y + tilt, zStart);
    const h = proj.cast(o, dir);
    if (h) last = { p: h.p.clone(), n: h.n.clone() };
    return last || { p: o.clone(), n: new THREE.Vector3(0, 0, Math.sign(-dir.z) || 1) };
  };
}
// rounded strip: a in 0..1 along, v in 0..1 across; ends rounded with exponent e
const roundEnds = (a, e = 6) => Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * a - 1), e)));
// Chaikin corner cutting for closed (x, z) loops
function chaikin(pts, iters = 3) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

// ---- assemble -------------------------------------------------------------------------------
export function buildCarMesh(options = {}) {
  const mats = createMaterials();
  for (const k of ['lens', 'tailLens', 'drl', 'headLens', 'tail', 'brake', 'reverse', 'grille', 'plate', 'chrome', 'satin', 'trim']) {
    mats[k].polygonOffset = true; mats[k].polygonOffsetFactor = -1; mats[k].polygonOffsetUnits = -1;
  }
  const root = new THREE.Group();
  root.name = 'Roadster';
  const body = new THREE.Group();     // sprung mass (pitch/roll/heave visuals)
  body.name = 'body';
  root.add(body);
  const add = (m, parent = body) => { parent.add(m); return m; };

  // ---------- skin
  const B = buildBodyGeometry();
  const skin = new THREE.Mesh(B.paint, [mats.paint, mats.shelf]);
  skin.castShadow = skin.receiveShadow = true; skin.name = 'skin';
  add(skin);
  { const u = new THREE.Mesh(B.under, [mats.carbon, mats.fascia]); u.castShadow = u.receiveShadow = true; add(u); }
  for (const g of [...B.wellTops, ...B.wellWalls]) add(mesh(g, mats.liner, false, true));
  add(mesh(B.wellEnds, mats.liner, false, true));

  // ---------- glass canopy + black frame
  const canopy = mesh(buildCanopyGeometry(), mats.glass, false, false);
  canopy.renderOrder = 6; canopy.name = 'canopy';
  add(canopy);
  const TE = CANOPY_TH_EDGE;
  const canopyRibbon = (fn, n, width, side, lift = 0.0025) => {
    const s = [];
    for (let i = 0; i <= n; i++) { const [z, th] = fn(i / n); s.push(canopySample(z, th, side)); }
    return mesh(ribbonGeometry(s, width, lift), mats.trim, false, true);
  };
  for (const side of [-1, 1]) {
    add(canopyRibbon((t) => [ZC0 + 0.012 + (ZC1 - 0.03 - ZC0 - 0.012) * t, 0.014], 60, 0.024, side));          // base
    add(canopyRibbon((t) => [ZC0 + 0.014 + (-0.05 - ZC0 - 0.014) * t, 0.035 + (TE - 0.035) * Math.pow(t, 0.85)], 26, 0.05, side)); // A-pillar
    add(canopyRibbon((t) => [-0.05, TE + (Math.PI / 2 - TE) * t], 12, 0.045, side));                             // header
    add(canopyRibbon((t) => [-0.05 + 0.77 * t, TE], 24, 0.034, side));                                           // roof rail
    add(canopyRibbon((t) => [0.745, 0.01 + (Math.PI / 2 - 0.01) * t], 18, 0.075, side));                         // targa hoop
    add(canopyRibbon((t) => [0.79 + (ZC1 - 0.1 - 0.79) * t, TE * (1 - 0.25 * t)], 14, 0.024, side));             // rear rail
  }

  // ---------- interior
  const interior = buildInterior(mats);
  add(interior.group);

  // ---------- shut lines, handles, side vents (on the analytic skin)
  const seam = (samples, w = 0.0045) => add(mesh(ribbonGeometry(samples, w, 0.0012), mats.seam, false, false));
  for (const side of [-1, 1]) {
    const zF0 = -0.985, zF1 = -0.952, zR0 = 0.5, zR1 = 0.64;
    const uB = (z) => uAtY(z, YB(z) + 0.065);
    const front = [], rear = [], bottom = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      front.push(bodySample(zF0 + (zF1 - zF0) * t, uB(zF0) + (I_RIM - 0.05 - uB(zF0)) * t, side));
      rear.push(bodySample(zR0 + (zR1 - zR0) * Math.pow(t, 1.6), uB(zR0) + (I_RIM - 0.05 - uB(zR0)) * t, side));
    }
    for (let i = 0; i <= 30; i++) { const z = zF0 + (zR0 - zF0) * (i / 30); bottom.push(bodySample(z, uB(z), side)); }
    seam(front); seam(rear); seam(bottom);
    // flush door handle
    add(mesh(patchGeometry(10, 2, (a, v) => {
      const z = 0.2 + 0.16 * a, yc = BELT(z) - 0.062, h = 0.022 * roundEnds(a, 4);
      return bodySample(z, uAtY(z, yc - h / 2 + h * v), side);
    }, 0.0018), mats.satin, false, true));
    // intake in the sculpted scallop ahead of the rear wheel
    add(mesh(patchGeometry(10, 4, (a, v) => {
      const z = 0.6 + 0.3 * a, h = (0.02 + 0.07 * a) * roundEnds(a, 8), yc = dentCentre(z) + 0.01;
      return bodySample(z, uAtY(z, yc - h / 2 + h * v), side);
    }, 0.0015), mats.grille, false, true));
  }
  // frunk and rear deck lid outlines (loops in plan, rounded)
  const lidLoop = (z0, z1, inset) => {
    const pts = [];
    const n = 10;
    for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * (i / n); pts.push([HW(z) - inset, z]); }
    for (let i = n; i >= 0; i--) { const z = z0 + (z1 - z0) * (i / n); pts.push([-(HW(z) - inset), z]); }
    const loop = chaikin(pts, 3);
    loop.push(loop[0]);
    return loop.map(([x, z]) => bodySample(z, uAtX(z, x), Math.sign(x) || 1));
  };
  seam(lidLoop(-0.86, -2.0, 0.31));
  seam(lidLoop(1.27, 2.18, 0.31));

  // ---------- nose & tail features projected onto the rounded ends
  const noseProj = new SurfaceProjector([B.paint, B.under], (a, b, c) => a.z < -1.55 && b.z < -1.55 && c.z < -1.55);
  const tailProj = new SurfaceProjector([B.paint, B.under], (a, b, c) => a.z > 1.7 && b.z > 1.7 && c.z > 1.7);
  const hdir = V3(0, -0.3, 1).normalize();
  const front = projSampler(noseProj, hdir, -3.0, 0.3 * 0.8);      // tilted: (x, y) given at z = -2.2
  const frontFlat = projSampler(noseProj, V3(0, 0, 1), -3.0, 0);
  const rear = projSampler(tailProj, V3(0, 0, -1), 3.0, 0);
  const strip = (sampler, nu, nv, x0, x1, yTop, hFn, lift, mat, opt = {}) => {
    const g = patchGeometry(nu, nv, (a, v) => {
      const x = x0 + (x1 - x0) * a, yt = yTop(a), h = hFn(a);
      return sampler(x, yt - h + h * (opt.v0 ?? 0) + h * ((opt.v1 ?? 1) - (opt.v0 ?? 0)) * v);
    }, lift);
    if (opt.uvScale) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * opt.uvScale[0], uv.getY(i) * opt.uvScale[1]); }
    return add(mesh(g, mat, false, true));
  };
  const headAnchors = [], brakeAnchors = [];
  for (const side of [-1, 1]) {
    // slim swept headlight: smoked lens, DRL blade along its top edge, projector pill
    const x0 = side * 0.36, x1 = side * 0.82;
    const yTop = (a) => 0.47 + 0.075 * Math.pow(a, 1.3);
    const hLens = (a) => (0.05 - 0.02 * a) * roundEnds(a, 5);
    strip(front, 18, 4, x0, x1, yTop, hLens, 0.002, mats.lens);
    strip(front, 18, 1, side * 0.375, side * 0.81, (a) => yTop(0.03 + 0.94 * a) - 0.004, (a) => 0.0085 * roundEnds(a, 8), 0.0042, mats.drl);
    strip(front, 6, 2, side * 0.39, side * 0.49, (a) => yTop(0.06 + 0.22 * a) - 0.016, (a) => 0.022 * roundEnds(a, 3), 0.0036, mats.headLens);
    const pa = front(side * 0.44, yTop(0.17) - 0.026);
    headAnchors.push(pa.p.clone().addScaledVector(pa.n, 0.03));
    // separate brake elements at the outer tail corners
    const bx0 = side * 0.52, bx1 = side * 0.8;
    const byTop = (a) => 0.735 + 0.012 * a;
    strip(rear, 10, 2, bx0, bx1, byTop, (a) => 0.032 * roundEnds(a, 5), 0.002, mats.tailLens);
    strip(rear, 10, 1, side * 0.53, side * 0.79, (a) => byTop(0.03 + 0.94 * a) - 0.008, (a) => 0.014 * roundEnds(a, 6), 0.0036, mats.brake);
    const pb = rear(side * 0.66, 0.725);
    brakeAnchors.push(pb.p.clone().addScaledVector(pb.n, 0.04));
    // reverse lamps low in the fascia
    strip(rear, 4, 1, side * 0.3, side * 0.42, () => 0.39, (a) => 0.022 * roundEnds(a, 4), 0.003, mats.reverse);
  }
  // front intake with honeycomb + badge
  strip(frontFlat, 24, 2, -0.62, 0.62, () => 0.31, (a) => 0.07 * roundEnds(a, 6), 0.0018, mats.grille, { uvScale: [1.24 / 0.032, 0.07 / 0.028] });
  strip(frontFlat, 8, 3, -0.034, 0.034, (a) => 0.428 + 0.017 * roundEnds(a, 2), (a) => 0.034 * roundEnds(a, 2), 0.0025, mats.chrome);
  // full-width tail light bar in a smoked channel, plate, badge
  strip(rear, 40, 2, -0.875, 0.875, () => 0.808, (a) => 0.05 * roundEnds(a, 10), 0.002, mats.lens);
  strip(rear, 40, 1, -0.86, 0.86, () => 0.791, (a) => 0.014 * roundEnds(a, 12), 0.0036, mats.tail);
  strip(rear, 6, 4, -0.17, 0.17, () => 0.625, () => 0.17, 0.002, mats.trim);
  strip(rear, 6, 4, -0.153, 0.153, () => 0.616, () => 0.152, 0.0036, mats.plate);
  strip(rear, 8, 3, -0.034, 0.034, (a) => 0.685 + 0.017 * roundEnds(a, 2), (a) => 0.034 * roundEnds(a, 2), 0.0025, mats.chrome);
  const tc = rear(0, 0.784);
  const tailCentre = tc.p.clone().addScaledVector(tc.n, 0.05);

  // ---------- carbon aero: splitter, skirts, diffuser
  {
    const sh = new THREE.Shape(), N = 20, zBack = -1.93;
    const fz = [];
    for (let i = 0; i <= N; i++) {
      const x = -0.72 + (1.44 * i) / N, h = frontFlat(x, 0.24);
      fz.push([x, Math.min(zBack - 0.04, h.p.z - 0.012)]);
    }
    sh.moveTo(-0.72, -zBack);
    for (const [x, z] of fz) sh.lineTo(x, -z);
    sh.lineTo(0.72, -zBack); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 2, curveSegments: 4 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, YB(-2.0) - 0.018, 0);
    add(mesh(g, mats.carbon, true, true));
  }
  add(mesh(buildSkirt(SPEC.axleFront + 0.43, SPEC.axleRear - 0.43), mats.carbon, true, true));
  for (const x of [0, -0.28, 0.28, -0.56, 0.56, -0.735, 0.735]) {
    const f = mesh(buildDiffuserFin(x === 0 || Math.abs(x) > 0.7 ? 0.014 : 0.011), mats.carbon, true, true);
    f.position.x = x; add(f);
  }
  {
    const ledge = mesh(boxUV(new THREE.BoxGeometry(1.48, 0.012, 0.13), 1), mats.carbon, true, true);
    ledge.position.set(0, 0.302, 2.19); add(ledge);
    const back = mesh(boxUV(new THREE.BoxGeometry(1.47, 0.16, 0.012), 1), mats.carbon, false, true);
    back.position.set(0, 0.225, 2.125); add(back);
  }

  // ---------- thrusters (SpaceX cold-gas array): 4 down corners, 6 rear (diffuser), 2 front (intake)
  const nozzles = [];
  const addNozzle = (x, y, z, dir, re, thruster) => {
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    if (dir === 'back') holder.rotation.x = -Math.PI / 2;
    if (dir === 'fwd') holder.rotation.x = Math.PI / 2;
    holder.add(buildNozzle(re, mats));
    add(holder);
    nozzles.push({ holder, dir, re, thruster });
  };
  addNozzle(-0.56, YB(-1.95) - 0.035, -1.95, 'down', 0.05, THRUSTER.FL);
  addNozzle(0.56, YB(-1.95) - 0.035, -1.95, 'down', 0.05, THRUSTER.FR);
  addNozzle(-0.82, YB(1.9) - 0.035, 1.9, 'down', 0.05, THRUSTER.RL);
  addNozzle(0.82, YB(1.9) - 0.035, 1.9, 'down', 0.05, THRUSTER.RR);
  for (const x of [0.14, 0.42, 0.65]) {
    addNozzle(-x, 0.222, 2.215, 'back', 0.042, THRUSTER.REAR_L);
    addNozzle(x, 0.222, 2.215, 'back', 0.042, THRUSTER.REAR_R);
  }
  for (const side of [-1, 1]) {
    const h = frontFlat(side * 0.5, 0.272);
    addNozzle(side * 0.5, 0.272, h.p.z - 0.004, 'fwd', 0.026, side < 0 ? THRUSTER.FRONT_L : THRUSTER.FRONT_R);
  }

  // ---------- mirrors
  for (const side of [-1, 1]) {
    const zm = -0.6;
    const base = bodySample(zm, I_RIM - 2.2, side);
    const head = buildMirror(mats);
    head.position.set(side * (HW(zm) + 0.075), base.p.y + 0.085, zm + 0.03);
    head.rotation.y = side * 0.08;
    add(head);
    const a = base.p.clone().addScaledVector(base.n, -0.005), b = head.position.clone().add(V3(-side * 0.05, -0.012, 0.02));
    const len = a.distanceTo(b);
    const stalk = mesh(new THREE.CylinderGeometry(0.009, 0.014, len, 8), mats.trim, true, true);
    stalk.position.copy(a).add(b).multiplyScalar(0.5);
    stalk.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
    stalk.scale.set(1.8, 1, 0.8);
    add(stalk);
  }

  // ---------- active ducktail blade (Car.js lifts/tilts it)
  const spoiler = new THREE.Group();
  {
    const zLE = 1.98, { geo, hingeY } = buildSpoilerBlade(zLE, 2.15, 0.6);
    spoiler.position.set(0, hingeY, zLE);
    const blade = mesh(geo, mats.paint, true, true);
    spoiler.add(blade);
    add(spoiler);
  }

  // ---------- wheels (not part of the sprung body)
  const geoF = wheelGeometries(0.245), geoR = wheelGeometries(0.305);
  const wheels = WHEEL_LOCAL.map((wl, i) => {
    const side = wl.x < 0 ? -1 : 1, front = i < 2;
    const w = buildWheel(front ? geoF : geoR, mats, side);
    w.pivot.position.set(wl.x, WR, wl.z);
    root.add(w.pivot);
    return { ...w, side, front, baseY: WR };
  });

  // ---------- headlights
  const headlights = [];
  headAnchors.forEach((p, i) => {
    const side = i === 0 ? -1 : 1;
    const l = new THREE.SpotLight(0xf2f6ff, 0, 140, 0.42, 0.55, 1.4);
    l.castShadow = false;
    l.position.copy(p);
    l.target.position.set(side * 1.6, 0, -40);
    body.add(l, l.target);
    headlights.push(l);
  });

  void options;
  return {
    root, body, wheels, nozzles, headlights, spoiler, mats, canopy, skin,
    yoke: interior.yoke, interior: interior.group,
    lightAnchors: { head: headAnchors, brake: brakeAnchors, tailCentre },
  };
}

/** Triangles of the car model (effects meshes flagged userData.fx are excluded unless includeFx). */
export function countTriangles(obj, includeFx = false) {
  let n = 0;
  obj.traverse((o) => {
    if (!includeFx && o.userData && o.userData.fx) return;
    if (o.isMesh && o.geometry && !(o.parent && o.parent.userData && o.parent.userData.fx && !includeFx)) {
      const g = o.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return n;
}

export { clamp, section };

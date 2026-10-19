// Hero-car effects. Everything is pooled and preallocated: no allocations per frame.
//  - thruster plumes: layered additive lathe cones (hot core + blue-white sheath, shock diamonds,
//    flicker, length by thrust) + exit glow sprites, attached to the nozzle anchors (car space)
//  - ground dust: radial particle sheet + ground ring that react to height above the surface
//  - tyre smoke particles and persistent skid marks (ring-buffer quad trail, oldest fade out)
//  - sparks on impacts / wall scrapes / hard landings (velocity-stretched additive streaks)
//  - headlight volumetric cones + glare sprites (night), brake-light halos, brake-disc glow
import * as THREE from 'three';
import * as TX from './carTextures.js';
import { WHEEL_LOCAL } from './Physics.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const rnd = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------------------------------
// billboard particle pool (instanced quads, world space)
// ------------------------------------------------------------------------------------------
const PARTICLE_VS = /* glsl */`
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec4 iData;   // size, alpha, rotation, unused
  attribute vec3 iColor;
  uniform float uStreak;
  uniform float uLight;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    vec2 q = position.xy;
    float size = iData.x;
    if (uStreak > 0.0) {
      vec2 d = (modelViewMatrix * vec4(iVel, 0.0)).xy;
      float l = length(d);
      vec2 dir = l > 1e-4 ? d / l : vec2(1.0, 0.0);
      vec2 nrm = vec2(-dir.y, dir.x);
      float len = size + l * uStreak;
      mvPosition.xy += dir * (q.x - 0.5) * len + nrm * q.y * size;
    } else {
      float c = cos(iData.z), s = sin(iData.z);
      mvPosition.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * size;
    }
    vAlpha = iData.y;
    vColor = iColor * uLight;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const PARTICLE_FS = /* glsl */`
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

function copyN(arr, n, i, j) { for (let k = 0; k < n; k++) arr[i * n + k] = arr[j * n + k]; }

class ParticlePool {
  constructor(max, { map, additive = false, streak = 0, light = 1, renderOrder = 8, fadeIn = 0.12 }) {
    this.max = max; this.count = 0; this.fadeInTime = fadeIn;
    const f = (n) => new Float32Array(max * n);
    this.p = f(3); this.v = f(3); this.age = f(1); this.life = f(1); this.s0 = f(1); this.s1 = f(1);
    this.a0 = f(1); this.rot = f(1); this.rotV = f(1); this.c = f(3); this.c1 = f(3); this.drag = f(1); this.grav = f(1);
    this.floor = f(1); this.fadeIn = f(1);
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(f(3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(f(3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(f(4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(f(3), 3).setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('iPos', this.aPos); quad.setAttribute('iVel', this.aVel);
    quad.setAttribute('iData', this.aData); quad.setAttribute('iColor', this.aColor);
    quad.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: null }, uStreak: { value: streak }, uLight: { value: light } }]),
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.material.uniforms.uMap.value = map;
    this.mesh = new THREE.Mesh(quad, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.userData.fx = true;
    this.geo = quad;
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b, drag, grav, floor = -1e9, r1 = r, g1 = g, b1 = b) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.rot[i] = Math.random() * 6.283; this.rotV[i] = rnd(-1.2, 1.2);
    this.c[i * 3] = r; this.c[i * 3 + 1] = g; this.c[i * 3 + 2] = b;
    this.c1[i * 3] = r1; this.c1[i * 3 + 1] = g1; this.c1[i * 3 + 2] = b1;
    this.drag[i] = drag; this.grav[i] = grav; this.floor[i] = floor; this.fadeIn[i] = this.fadeInTime;
    return i;
  }

  _kill(i) {
    const j = --this.count;
    if (i === j) return;
    copyN(this.p, 3, i, j); copyN(this.v, 3, i, j); copyN(this.c, 3, i, j); copyN(this.c1, 3, i, j);
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.a0[i] = this.a0[j]; this.rot[i] = this.rot[j]; this.rotV[i] = this.rotV[j]; this.drag[i] = this.drag[j];
    this.grav[i] = this.grav[j]; this.floor[i] = this.floor[j]; this.fadeIn[i] = this.fadeIn[j];
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._kill(i); i--; continue; }
      const dr = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= dr; this.v[i * 3 + 1] = this.v[i * 3 + 1] * dr - this.grav[i] * dt; this.v[i * 3 + 2] *= dr;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < this.floor[i]) { // bounce (sparks) / settle (dust)
        this.p[i * 3 + 1] = this.floor[i];
        this.v[i * 3 + 1] = Math.abs(this.v[i * 3 + 1]) * 0.35;
        this.v[i * 3] *= 0.6; this.v[i * 3 + 2] *= 0.6;
      }
      this.rot[i] += this.rotV[i] * dt;
    }
    const n = this.count, P = this.aPos.array, Vv = this.aVel.array, D = this.aData.array, C = this.aColor.array;
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i];
      P[i * 3] = this.p[i * 3]; P[i * 3 + 1] = this.p[i * 3 + 1]; P[i * 3 + 2] = this.p[i * 3 + 2];
      Vv[i * 3] = this.v[i * 3]; Vv[i * 3 + 1] = this.v[i * 3 + 1]; Vv[i * 3 + 2] = this.v[i * 3 + 2];
      const fin = Math.min(1, this.age[i] / this.fadeIn[i]);
      D[i * 4] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      D[i * 4 + 1] = this.a0[i] * fin * (1 - t) * (1 - t);
      D[i * 4 + 2] = this.rot[i];
      for (let k = 0; k < 3; k++) C[i * 3 + k] = this.c[i * 3 + k] + (this.c1[i * 3 + k] - this.c[i * 3 + k]) * t;
    }
    for (const a of [this.aPos, this.aVel, this.aColor]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, n) * 3); a.needsUpdate = true; }
    this.aData.clearUpdateRanges(); this.aData.addUpdateRange(0, Math.max(1, n) * 4); this.aData.needsUpdate = true;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
  }
}

// ------------------------------------------------------------------------------------------
// skid marks: ring buffer of ground quads, oldest fade out before being overwritten
// ------------------------------------------------------------------------------------------
const SKID_VS = /* glsl */`
  attribute float aAlpha;
  attribute float aId;
  uniform float uHead;
  uniform float uCap;
  varying float vAlpha;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    float age = (uHead - aId) / uCap;
    vAlpha = aAlpha * (1.0 - smoothstep(0.7, 1.0, age));
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const SKID_FS = /* glsl */`
  varying float vAlpha;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    float edge = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
    float tread = 0.8 + 0.2 * step(0.5, fract(vUv.y * 4.0));
    gl_FragColor = vec4(vec3(0.012, 0.012, 0.013), vAlpha * edge * tread);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

class SkidMarks {
  constructor(maxQuads = 1600) {
    this.max = maxQuads; this.head = 0;
    const nV = maxQuads * 4;
    this.pos = new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.alpha = new THREE.BufferAttribute(new Float32Array(nV), 1).setUsage(THREE.DynamicDrawUsage);
    this.id = new THREE.BufferAttribute(new Float32Array(nV).fill(-1e9), 1).setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(nV * 2);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      const v = q * 4;
      uv.set([0, 0, 0, 1, 1, 0, 1, 1], v * 2);
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], q * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', this.pos);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aAlpha', this.alpha);
    g.setAttribute('aId', this.id);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uHead: { value: 0 }, uCap: { value: maxQuads } }]),
      vertexShader: SKID_VS, fragmentShader: SKID_FS, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.userData.fx = true;
    this.geo = g;
    // per-wheel trail state
    this.trail = Array.from({ length: 4 }, () => ({ on: false, l: new THREE.Vector3(), r: new THREE.Vector3(), c: new THREE.Vector3(), a: 0 }));
    this._l = new THREE.Vector3(); this._r = new THREE.Vector3();
  }

  _quad(l0, r0, l1, r1, a0, a1) {
    const q = this.head % this.max, v = q * 4, P = this.pos.array, o = v * 3;
    P[o] = l0.x; P[o + 1] = l0.y; P[o + 2] = l0.z; P[o + 3] = r0.x; P[o + 4] = r0.y; P[o + 5] = r0.z;
    P[o + 6] = l1.x; P[o + 7] = l1.y; P[o + 8] = l1.z; P[o + 9] = r1.x; P[o + 10] = r1.y; P[o + 11] = r1.z;
    this.alpha.array[v] = a0; this.alpha.array[v + 1] = a0; this.alpha.array[v + 2] = a1; this.alpha.array[v + 3] = a1;
    const id = this.head;
    this.id.array[v] = id; this.id.array[v + 1] = id; this.id.array[v + 2] = id; this.id.array[v + 3] = id;
    this.pos.addUpdateRange(v * 3, 12); this.alpha.addUpdateRange(v, 4); this.id.addUpdateRange(v, 4);
    this.pos.needsUpdate = this.alpha.needsUpdate = this.id.needsUpdate = true;
    this.head++;
    this.geo.setDrawRange(0, Math.min(this.head, this.max) * 6);
    this.material.uniforms.uHead.value = this.head;
  }

  /** contact: world point on the ground; right: unit wheel axis; intensity 0..1 (0 ends the trail). */
  feed(i, contact, right, halfWidth, intensity) {
    const tr = this.trail[i];
    if (intensity <= 0.02) { tr.on = false; return; }
    const l = this._l.copy(contact).addScaledVector(right, -halfWidth);
    const r = this._r.copy(contact).addScaledVector(right, halfWidth);
    if (!tr.on) { tr.on = true; tr.l.copy(l); tr.r.copy(r); tr.c.copy(contact); tr.a = intensity; return; }
    const d2 = tr.c.distanceToSquared(contact);
    if (d2 < 0.2 * 0.2) return;
    if (d2 > 4) { tr.l.copy(l); tr.r.copy(r); tr.c.copy(contact); tr.a = intensity; return; } // teleport/reset
    this._quad(tr.l, tr.r, l, r, tr.a * 0.78, intensity * 0.78);
    tr.l.copy(l); tr.r.copy(r); tr.c.copy(contact); tr.a = intensity;
  }

  clear() { this.head = 0; this.geo.setDrawRange(0, 0); for (const t of this.trail) t.on = false; this.id.array.fill(-1e9); this.id.needsUpdate = true; }
}

// ------------------------------------------------------------------------------------------
// volumetric-ish additive cone shader (thruster plumes, headlight beams)
// ------------------------------------------------------------------------------------------
const CONE_VS = /* glsl */`
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vT = -position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const CONE_FS = /* glsl */`
  uniform vec3 uCore;
  uniform vec3 uEdge;
  uniform float uLevel;
  uniform float uTime;
  uniform float uSeed;
  uniform float uFall;
  uniform float uSharp;
  uniform float uDiam;
  uniform float uTurb;
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float t = clamp(vT, 0.0, 1.0);
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float body = pow(facing, uSharp);
    float axial = pow(1.0 - t, uFall) * smoothstep(0.0, 0.05, t + 0.01);
    float turb = 1.0 - uTurb + uTurb * (0.6 + 0.4 * sin(uTime * 53.0 + t * 31.0 + uSeed) * sin(uTime * 29.0 - t * 19.0 + uSeed * 2.3));
    float d = pow(max(0.0, sin(t * 26.0 - uTime * 3.0 + uSeed)), 8.0);
    float diam = 1.0 + uDiam * d * (1.0 - t);
    vec3 col = mix(uCore, uEdge, smoothstep(0.0, 0.9, t + (1.0 - facing) * 0.45));
    float a = body * axial * turb * diam * uLevel;
    gl_FragColor = vec4(col * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function coneMaterial(o) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color(o.core) }, uEdge: { value: new THREE.Color(o.edge) },
      uLevel: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 10 },
      uFall: { value: o.fall ?? 1.4 }, uSharp: { value: o.sharp ?? 1.6 }, uDiam: { value: o.diam ?? 0 }, uTurb: { value: o.turb ?? 1 },
    },
    vertexShader: CONE_VS, fragmentShader: CONE_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
/** Unit-length flaring cone along -Y (apex region at the origin, radius r0 -> r1). */
function coneGeometry(r0, r1, segs = 18, rings = 12, power = 0.6) {
  const pts = [];
  for (let i = 0; i <= rings; i++) { const t = i / rings; pts.push(new THREE.Vector2(r0 + (r1 - r0) * Math.pow(t, power), -t)); }
  return new THREE.LatheGeometry(pts, segs);
}

// ------------------------------------------------------------------------------------------
// the effects controller
// ------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _dv = new THREE.Vector3();
const _contacts = Array.from({ length: 4 }, () => new THREE.Vector3());

export class CarEffects {
  /**
   * @param parts  result of buildCarMesh (nozzles, body, lightAnchors, mats, wheels)
   */
  constructor(parts) {
    this.parts = parts;
    const glow = TX.glowTexture(), puff = TX.puffTexture();
    this.glowTex = glow;
    this.world = new THREE.Group();
    this.world.name = 'CarEffects';
    this.world.userData.fx = true;

    // ---- plumes on the nozzle anchors
    this.plumes = [];
    const coreGeo = coneGeometry(0.5, 0.95, 16, 10, 0.7);
    const sheathGeo = coneGeometry(1.0, 3.2, 18, 12, 0.55);
    for (const nz of parts.nozzles) {
      const core = new THREE.Mesh(coreGeo, coneMaterial({ core: 0xfff6ea, edge: 0x9cc6ff, fall: 1.2, sharp: 1.2, diam: 1.6, turb: 0.5 }));
      const sheath = new THREE.Mesh(sheathGeo, coneMaterial({ core: 0xbfd9ff, edge: 0x2f5fd8, fall: 1.6, sharp: 2.2, diam: 0.4, turb: 1 }));
      for (const m of [core, sheath]) { m.frustumCulled = false; m.renderOrder = 10; m.visible = false; m.userData.fx = true; nz.holder.add(m); }
      let spr = null;
      if (glow) {
        spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0x9ccaff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
        spr.position.y = -nz.re * 0.6; spr.visible = false; spr.renderOrder = 11; spr.userData.fx = true;
        nz.holder.add(spr);
      }
      core.position.y = sheath.position.y = -0.004;
      this.plumes.push({ ...nz, core, sheath, spr });
    }

    // ---- particle pools (world space)
    this.dust = puff ? new ParticlePool(240, { map: puff, renderOrder: 7 }) : null;
    this.smoke = puff ? new ParticlePool(300, { map: puff, renderOrder: 7 }) : null;
    this.sparks = glow ? new ParticlePool(240, { map: glow, additive: true, streak: 0.035, renderOrder: 12, fadeIn: 0.001 }) : null;
    for (const p of [this.dust, this.smoke, this.sparks]) if (p) this.world.add(p.mesh);
    this.skids = new SkidMarks(1600);
    this.world.add(this.skids.mesh);

    // ---- ground ring under a low hover (shock sheet)
    const ringGeo = new THREE.RingGeometry(0.2, 1, 56, 4);
    {
      const p = ringGeo.attributes.position, col = new Float32Array(p.count * 4);
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getY(i)), th = Math.atan2(p.getY(i), p.getX(i));
        const radial = Math.pow(Math.sin(Math.PI * clamp((r - 0.2) / 0.8, 0, 1)), 1.6);
        const streak = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(7 * th + 1.3) * Math.sin(3 * th + r * 6));
        col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1; col[i * 4 + 3] = radial * streak;
      }
      ringGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      ringGeo.rotateX(-Math.PI / 2);
    }
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xc9bba4, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.visible = false; this.ring.frustumCulled = false; this.ring.renderOrder = 3; this.ring.userData.fx = true;
    this.world.add(this.ring);

    // ---- headlight beams + glare, brake halos (car body space)
    this.beams = [];
    const beamGeo = coneGeometry(0.06, 1, 20, 10, 0.9);
    for (const a of parts.lightAnchors.head) {
      const m = new THREE.Mesh(beamGeo, coneMaterial({ core: 0xfff8ec, edge: 0xc8d8ff, fall: 1.3, sharp: 2.6, diam: 0, turb: 0.06 }));
      m.position.copy(a);
      m.rotation.x = Math.PI / 2 - 0.06;      // -Y -> forward (-Z), aimed slightly down
      m.scale.set(2.6, 16, 2.6);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 9; m.userData.fx = true;
      parts.body.add(m);
      this.beams.push(m);
    }
    const halo = (pos, color, scale) => {
      if (!glow) return null;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
      s.position.copy(pos); s.scale.setScalar(scale); s.visible = false; s.renderOrder = 11; s.userData.fx = true;
      parts.body.add(s);
      return s;
    };
    this.glare = parts.lightAnchors.head.map((p) => halo(p, 0xf4f8ff, 0.7));
    this.brakeHalos = parts.lightAnchors.brake.map((p) => halo(p, 0xff2a1a, 0.5));
    this.tailHalo = halo(parts.lightAnchors.tailCentre, 0xff2010, 1.0);
    if (this.tailHalo) this.tailHalo.scale.set(2.2, 0.35, 1);

    this.time = 0;
    this.heat = 0;            // brake-disc temperature 0..1
    this._prevVel = new THREE.Vector3();
    this._hasPrev = false;
    this._dustAcc = 0; this._smokeAcc = 0; this._sparkAcc = 0;
  }

  /** Add the world-space systems (particles, skid marks, ground ring) to a scene. */
  attach(scene) { if (scene && !this.world.parent) scene.add(this.world); }

  reset() {
    this.skids.clear();
    for (const p of [this.dust, this.smoke, this.sparks]) if (p) { p.count = 0; p.update(0); }
    this._hasPrev = false; this.heat = 0;
  }

  /**
   * @param dt
   * @param ph   CarPhysics
   * @param o    { braking, darkness 0..1, nightLights 0..1, ambient 0..1 }
   */
  update(dt, ph, o) {
    if (!(dt > 0)) return;
    this.time += dt;
    const t = this.time;
    const flying = !ph.grounded && !ph.upsideDown;
    _q.copy(ph.quaternion);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    _right.set(1, 0, 0).applyQuaternion(_q);
    const groundY = ph.position.y - ph.altitude;
    const speed = ph.speed;

    // ---------------- plumes
    let anyThrust = 0;
    for (let i = 0; i < this.plumes.length; i++) {
      const pl = this.plumes[i];
      const lvl = ph.thrusters[pl.thruster] || 0;
      anyThrust = Math.max(anyThrust, lvl);
      const on = lvl > 0.02;
      pl.core.visible = pl.sheath.visible = on;
      if (pl.spr) pl.spr.visible = on;
      if (!on) continue;
      const fl = 0.86 + 0.14 * Math.sin(t * 61 + i * 1.7) * Math.sin(t * 23.3 + i * 0.7);
      let len = pl.dir === 'down' ? 0.45 + 1.7 * lvl : pl.dir === 'back' ? 0.55 + 2.3 * lvl * (ph.boosting ? 1.25 : 1) : 0.3 + 1.1 * lvl;
      if (pl.dir === 'down' && !ph.upsideDown) len = Math.min(len, Math.max(0.12, ph.altitude + 0.14)); // plume splashes on the ground
      len *= fl;
      const re = pl.re, w = re * (0.85 + 0.35 * lvl);
      pl.core.scale.set(w, len * 0.55, w);
      pl.sheath.scale.set(w * (0.9 + 0.3 * lvl), len, w * (0.9 + 0.3 * lvl));
      const cu = pl.core.material.uniforms, su = pl.sheath.material.uniforms;
      cu.uTime.value = su.uTime.value = t;
      cu.uLevel.value = (0.55 + 0.9 * lvl) * fl;
      su.uLevel.value = (0.18 + 0.45 * lvl) * fl;
      if (pl.spr) { pl.spr.material.opacity = Math.min(1, 0.35 + 0.65 * lvl) * fl; pl.spr.scale.setScalar(re * (5 + 4 * lvl)); }
    }
    const M = this.parts.mats;
    M.nozzle.emissiveIntensity = anyThrust * 0.35;
    M.nozzleIn.emissiveIntensity = anyThrust * 3.2;

    // ---------------- ground dust (hovering low)
    const lift = ph.liftCmd;
    const alt = ph.altitude;
    const dustAmt = lift > 0.04 && !ph.upsideDown && Number.isFinite(groundY) ? clamp(lift * 1.8, 0, 1) * clamp(1 - alt / 9, 0, 1) : 0;
    this.ring.visible = dustAmt > 0.01;
    if (this.ring.visible) {
      const r = 2.0 + alt * 0.9 + 0.2 * Math.sin(t * 7);
      this.ring.position.set(ph.position.x, groundY + 0.05, ph.position.z);
      this.ring.scale.set(r, 1, r);
      this.ring.rotation.y = t * 0.8;
      this.ringMat.opacity = 0.32 * dustAmt * (0.85 + 0.15 * Math.sin(t * 13));
    }
    if (this.dust) {
      if (dustAmt > 0.01) {
        this._dustAcc += dt * 150 * dustAmt;
        const lc = o.ambient;
        while (this._dustAcc >= 1) {
          this._dustAcc -= 1;
          const a = Math.random() * 6.283, r0 = rnd(0.6, 1.5);
          const sp = rnd(5, 11) * (0.4 + 0.6 * dustAmt) * (1.2 - alt / 10);
          const ca = Math.cos(a), sa = Math.sin(a);
          this.dust.spawn(ph.position.x + ca * r0, groundY + rnd(0.05, 0.25), ph.position.z + sa * r0,
            ca * sp + ph.velocity.x * 0.3, rnd(0.2, 1.1), sa * sp + ph.velocity.z * 0.3,
            rnd(0.7, 1.5), rnd(0.6, 1.0), rnd(2.4, 3.8), 0.34 * dustAmt,
            0.74 * lc, 0.68 * lc, 0.6 * lc, 1.6, -0.15, groundY + 0.05);
        }
      }
      this.dust.update(dt);
    }

    // ---------------- tyres: contacts, skid marks, smoke
    const slip = ph.wheelSlip;
    const grounded = ph.grounded && !ph.upsideDown;
    for (let i = 0; i < 4; i++) {
      const c = _contacts[i].copy(WHEEL_LOCAL[i]).applyQuaternion(_q).add(ph.position).addScaledVector(_up, 0.012);
      const touching = grounded && (ph.wheelGaps ? ph.wheelGaps[i] < 0.06 : true);
      const rear = i >= 2;
      let k = 0;
      if (touching) k = rear ? clamp((slip - 0.18) / 0.45, 0, 1) : clamp((slip - 0.5) / 0.4, 0, 1) * 0.7;
      if (touching && speed < 0.5 && slip < 0.6) k = 0;
      this.skids.feed(i, c, _right, rear ? 0.15 : 0.122, k);
      if (this.smoke && k > 0.12) {
        this._smokeAcc += dt * 55 * k;
        const lc = o.ambient;
        while (this._smokeAcc >= 1) {
          this._smokeAcc -= 1;
          this.smoke.spawn(c.x + rnd(-0.15, 0.15), c.y + rnd(0.05, 0.3), c.z + rnd(-0.15, 0.15),
            ph.velocity.x * 0.22 + rnd(-0.8, 0.8), rnd(0.3, 1.2), ph.velocity.z * 0.22 + rnd(-0.8, 0.8),
            rnd(1.3, 2.6), rnd(0.35, 0.6), rnd(2.4, 4.2), 0.3 * Math.min(1, k + 0.2),
            0.86 * lc, 0.86 * lc, 0.88 * lc, 1.3, -0.35);
        }
      }
    }
    if (this.smoke) this.smoke.update(dt);

    // ---------------- sparks (impacts, wall scrapes, hard landings)
    if (this.sparks) {
      if (this._hasPrev) {
        _dv.copy(ph.velocity).sub(this._prevVel);
        const imp = ph.impact;
        let burst = 0, scrape = 0;
        if (imp > 2.5) burst = Math.min(60, Math.round(imp * 2.5));
        else if (imp > 0.35 && speed > 5) scrape = 1;
        if (ph.landedThisStep && ph.landingImpact > 6.5) burst = Math.max(burst, Math.min(50, Math.round(ph.landingImpact * 3)));
        if (ph.bodyContact && speed > 3) scrape = 1;
        if (burst || scrape) {
          // contact normal ~ direction of the velocity change; contact point on the body box toward the obstacle
          const dl = _dv.length();
          if (dl > 1e-4) _n.copy(_dv).divideScalar(dl); else _n.copy(_up);
          let lx = _n.dot(_right), ly = _n.dot(_up), lz = -_n.dot(_fwd);
          if (ph.landedThisStep && ph.landingImpact > 6.5) { lx = 0; ly = 1; lz = 0; }
          const cx = -Math.sign(lx) * Math.min(1, Math.abs(lx) * 2.5) * 0.98;
          const cz = -Math.sign(lz) * Math.min(1, Math.abs(lz) * 2.5) * 2.25;
          const cy = ly > 0.6 ? 0.14 : ph.upsideDown ? 1.05 : 0.38;
          _a.copy(ph.position).addScaledVector(_right, cx).addScaledVector(_up, cy).addScaledVector(_fwd, -cz);
          const count = burst || 0;
          this._sparkAcc += scrape ? dt * 260 : 0;
          let n = count + Math.floor(this._sparkAcc);
          this._sparkAcc -= Math.floor(this._sparkAcc);
          while (n-- > 0) {
            const s = rnd(2, 8);
            _b.set(rnd(-1, 1), rnd(0.2, 1.2), rnd(-1, 1)).multiplyScalar(s).addScaledVector(_n, rnd(1, 4)).addScaledVector(ph.velocity, rnd(0.35, 0.8));
            const hot = Math.random();
            this.sparks.spawn(_a.x + rnd(-0.25, 0.25), _a.y + rnd(-0.08, 0.08), _a.z + rnd(-0.25, 0.25), _b.x, _b.y, _b.z,
              rnd(0.25, 0.7), rnd(0.025, 0.045), 0.012, 1.0,
              1.0, 0.85 + 0.15 * hot, 0.55 + 0.4 * hot, 0.15, 9.81, groundY + 0.02, 1.0, 0.25, 0.05);
          }
        }
      }
      this.sparks.update(dt);
    }
    this._prevVel.copy(ph.velocity); this._hasPrev = true;

    // ---------------- brakes: disc glow and light halos
    const hardBrake = o.braking && grounded && speed > 6;
    this.heat = clamp(this.heat + (hardBrake ? (speed / 70) * dt * 0.9 : 0) - dt * 0.07, 0, 1);
    M.disc.emissiveIntensity = Math.pow(this.heat, 1.6) * 2.6;

    const dark = clamp(o.darkness, 0, 1);
    const brakeGlow = o.braking ? 1 : 0;
    for (const h of this.brakeHalos) if (h) {
      const a = brakeGlow * (0.55 + 0.45 * dark);
      h.visible = a > 0.01;
      h.material.opacity = a;
      h.scale.setScalar(0.42 + 0.5 * dark);
    }
    if (this.tailHalo) {
      const a = 0.35 * dark + 0.25 * brakeGlow * dark;
      this.tailHalo.visible = a > 0.01;
      this.tailHalo.material.opacity = a;
    }
    const beamA = dark * clamp(o.nightLights, 0, 1);
    for (const b of this.beams) {
      b.visible = beamA > 0.02;
      b.material.uniforms.uLevel.value = 0.04 * beamA;
      b.material.uniforms.uTime.value = t;
    }
    for (const g of this.glare) if (g) {
      g.visible = beamA > 0.02;
      g.material.opacity = 0.4 * beamA;
    }
  }
}

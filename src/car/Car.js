// Roadster: electric hypercar with a cold-gas thruster package.
// Owns the visual model (CarMesh), the effects (Effects) and drives both from the engine's VehicleController.
import * as THREE from 'three';
import { VehicleController, ROADSTER_SPEC } from '@vibe/engine/physics';
import { buildCarMesh, countTriangles } from './CarMesh.js';
import { CarEffects } from './Effects.js';

export { Input } from './Input.js';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();

// hero materials pinned to scene.environment with a boost over the world's environment intensity
const ENV_BOOST = { paint: 1.2, glass: 1.1, chrome: 1.4, rim: 1.35, mirror: 1.4, carbon: 0.85, trim: 1.4, lens: 1.4, caliper: 1.2, tailLens: 1.3, satin: 1.2 };

export class Car {
  /**
   * @param {THREE.Scene|THREE.Object3D|null} scene  parent to add the car (and world-space effects) to
   * @param {object} options  { night: 'auto' (default: follows world.sunDirection) | 0..1 | boolean,
   *                             headlightIntensity, hoverAssist, envBoost, spec (VehicleController spec) }
   */
  constructor(scene, options = {}) {
    this.scene = scene || null;
    this.options = { night: 'auto', headlightIntensity: 220, hoverAssist: true, envBoost: 1, ...options };
    this.physics = new VehicleController(this.options.spec || ROADSTER_SPEC, { hoverAssist: this.options.hoverAssist });
    this._root = new THREE.Group();
    this._root.name = 'CarRoot';
    if (this.scene) this.scene.add(this._root);
    this._parts = null;
    this._fx = null;
    this._world = null;
    this._time = 0;
    this._spoiler = 0;
    this._night = 1;
    this._auto = false;
    this._env = null;
    this._darkness = 1;
    this.setNight(this.options.night);
    this._state = {
      speedKmh: 0, altitude: 0, mode: 'ground', thrust: 0, gForce: 1,
      velocity: new THREE.Vector3(), grounded: true, rpmLike: 0, thrusterLevel: 1,
      damage: 0, boostLevel: 1, steer: 0, wheelSlip: 0,
      // extras (not in the base contract, handy for HUD/audio/camera)
      heading: 0, forwardSpeed: 0, verticalSpeed: 0, boosting: false, braking: false,
      reversing: false, upsideDown: false, impact: 0, landed: false, landingImpact: 0,
      liftCmd: 0, thrustInput: 0, thrusters: this.physics.thrusters, triangles: 0,
    };
    this._syncPose();
  }

  async load() {
    if (this._parts) return this;
    const parts = buildCarMesh(this.options);
    this._parts = parts;
    this._root.add(parts.root);
    this._fx = new CarEffects(parts);
    if (this.scene) this._fx.attach(this.scene);
    this._state.triangles = countTriangles(parts.root);
    this.setNight(this._auto ? 'auto' : this._night);
    this._updateVisuals(0, null);
    return this;
  }

  /**
   * Place the car on the ground at `position` facing `headingRad` (0 = -Z, + = left).
   * Uses the last world seen by update() (or the optional `world`) for the ground height;
   * with no world at all, position.y is taken as the ground.
   */
  reset(position, headingRad = 0, world) {
    if (world) this._world = world;
    const p = position ? _v.copy(position) : _v.set(0, 0, 0);
    this.physics.reset(p, headingRad, this._world);
    this._syncPose();
    this._prevPos.copy(this.physics.position); this._prevQuat.copy(this.physics.quaternion);
    if (this._fx) this._fx.reset();
    this._updateVisuals(0, null);
  }

  /**
   * Headlights: 'auto' follows the world's sun (low daytime running light, full after dusk);
   * 0..1 (or boolean) forces an intensity scale independent of the world.
   */
  setNight(v) {
    this._auto = v === 'auto';
    if (!this._auto) this._night = typeof v === 'boolean' ? (v ? 1 : 0) : Math.min(1, Math.max(0, Number(v) || 0));
    this._applyHeadlights(this._auto ? this._darkness : this._night);
  }

  _applyHeadlights(level) {
    if (!this._parts) return;
    const lv = this._auto ? Math.max(0.04, level) : level;
    for (const l of this._parts.headlights) {
      l.intensity = this.options.headlightIntensity * lv;
      l.visible = lv > 0.01;
    }
    this._parts.mats.headLens.emissiveIntensity = 0.4 + 3.2 * lv;
    // cabin screens dim after dark
    const d = this._auto ? level : this._night;
    this._parts.mats.screen.emissiveIntensity = 1.0 * (1 - 0.65 * d);
    this._parts.mats.cluster.emissiveIntensity = 0.9 * (1 - 0.6 * d);
  }

  get night() { return this._night; }
  get object3d() { return this._root; }
  /** The world-space effects group (particles, skid marks). Added to the scene automatically. */
  get effects() { return this._fx; }

  /** Fixed-step update: physics + visuals. `input` may be null; `world` may be null. */
  update(dt, input, world) {
    if (world !== undefined) this._world = world;
    const c = input || NO_INPUT;
    if (!this._prevPos) this._syncPose();
    this._prevPos.copy(this.physics.position);
    this._prevQuat.copy(this.physics.quaternion);
    this.physics.step(dt, c, this._world);
    if (input && typeof input.setFlightMode === 'function') input.setFlightMode(this.physics.mode === 'flight');
    this._syncPose();
    this._time += dt;
    this._updateVisuals(dt, c);
  }

  get state() {
    const ph = this.physics, s = this._state;
    s.speedKmh = ph.speed * 3.6;
    s.altitude = ph.altitude;
    s.mode = ph.mode;
    s.thrust = Math.max(ph.liftCmd, Math.max(ph.thrusters[4], ph.thrusters[5]));
    s.gForce = ph.gForce;
    s.velocity.copy(ph.velocity);
    s.grounded = ph.grounded || ph.upsideDown;
    s.rpmLike = Math.min(1, Math.abs(ph.wheelSpeed) / ph.spec.vMax + ph.wheelSlip * 0.08);
    s.thrusterLevel = ph.tank;
    s.damage = ph.damage;
    s.boostLevel = ph.boostLevel;
    s.steer = -ph.steerAngle / ph.spec.maxSteer;
    s.wheelSlip = ph.wheelSlip;
    s.heading = ph.heading;
    s.forwardSpeed = ph.forwardSpeed;
    s.verticalSpeed = ph.velocity.y;
    s.boosting = ph.boosting;
    s.braking = ph.braking;
    s.reversing = ph.reversing;
    s.upsideDown = ph.upsideDown;
    s.impact = ph.impact;
    s.landed = ph.landedThisStep;
    s.landingImpact = ph.landingImpact;
    s.liftCmd = ph.liftCmd;
    s.thrustInput = ph.thrustCmd;
    return s;
  }

  _syncPose() {
    this._root.position.copy(this.physics.position);
    this._root.quaternion.copy(this.physics.quaternion);
    if (!this._prevPos) { this._prevPos = this.physics.position.clone(); this._prevQuat = this.physics.quaternion.clone(); }
  }

  /**
   * Render-frame pose: blend between the previous and the current fixed step (alpha = accumulator / fixedDt,
   * from Engine.update). Removes the judder of 120 Hz physics shown at a variable frame rate.
   */
  interpolate(alpha) {
    if (!this._prevPos) return;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    this._root.position.lerpVectors(this._prevPos, this.physics.position, a);
    this._root.quaternion.slerpQuaternions(this._prevQuat, this.physics.quaternion, a);
  }

  // pin the hero materials to the scene environment (PMREM of the sky) with a reflection boost
  _syncEnv() {
    const sc = this.scene && this.scene.isScene ? this.scene : null;
    if (!sc || !this._parts) return;
    const env = sc.environment || null;
    const M = this._parts.mats;
    if (env !== this._env) {
      this._env = env;
      for (const k in ENV_BOOST) if (M[k]) { M[k].envMap = env; M[k].needsUpdate = true; }
    }
    if (!env) return;
    const base = (sc.environmentIntensity ?? 1) * this.options.envBoost;
    for (const k in ENV_BOOST) if (M[k]) M[k].envMapIntensity = base * ENV_BOOST[k];
  }

  _darknessFromWorld() {
    const w = this._world;
    let sunY = null;
    try { if (w && w.sunDirection) sunY = w.sunDirection.y; } catch (e) { sunY = null; }
    if (sunY === null || !Number.isFinite(sunY)) return this._auto ? 1 : this._night;
    const el = Math.asin(Math.max(-1, Math.min(1, sunY)));
    const t = Math.min(1, Math.max(0, (6 * DEG - el) / (15 * DEG)));
    return t * t * (3 - 2 * t);
  }

  _updateVisuals(dt, c) {
    const P = this._parts;
    if (!P) return;
    const ph = this.physics;
    const flying = !ph.grounded && !ph.upsideDown;
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.12) : 1;
    this._syncEnv();

    // --- suspension: the controller's body IS the sprung mass (heave, pitch and roll come out of its per-wheel
    //     springs), so the body mesh stays put on the root; each wheel follows its own contact point
    //     (wheels[i].y: local height vs the static position, negative = extended / hanging in the air)
    P.body.position.y = 0;
    P.body.rotation.set(0, 0, 0);

    // --- wheels + yoke ---------------------------------------------------------------------
    const WP = ph.wheels;
    for (let i = 0; i < P.wheels.length; i++) {
      const w = P.wheels[i];
      w.pivot.position.y = w.baseY + (WP[i] ? WP[i].y : 0);
      w.spin.rotation.x = -ph.wheelSpin;
      if (w.front) w.pivot.rotation.y = ph.steerAngle;
    }
    if (P.yoke) P.yoke.rotation.z = ph.steerAngle * 3.4;

    // --- lights (emissive > 1 is bloom-ready) ---------------------------------------------------
    const braking = !!(ph.braking || (c && c.handbrake) || (flying && c && c.brake > 0.1));
    const kl = Math.min(1, k * 3);
    P.mats.tail.emissiveIntensity += ((braking ? 4.5 : 2.2) - P.mats.tail.emissiveIntensity) * kl;
    P.mats.brake.emissiveIntensity += ((braking ? 9 : 0.15) - P.mats.brake.emissiveIntensity) * Math.min(1, k * 5);
    P.mats.tailLens.emissiveIntensity = 0.3 + (braking ? 0.9 : 0);
    P.mats.reverse.emissiveIntensity = ph.reversing ? 5 : 0;

    // --- active ducktail: rises at speed, airbrake when braking hard ----------------------------
    const v = ph.forwardSpeed;
    const sp = ph.braking && v > 25 ? 1 : v > 33 ? 0.35 : 0;
    this._spoiler += (sp - this._spoiler) * Math.min(1, k * 1.5);
    P.spoiler.rotation.x = -0.55 * this._spoiler;              // trailing edge up
    P.spoiler.children[0].position.y = this._spoiler * 0.06;   // lifts on its struts

    // --- effects ---------------------------------------------------------------------------------
    if (dt > 0 && this._fx) {
      const d = this._darknessFromWorld();
      if (this._auto && Math.abs(d - this._darkness) > 0.01) this._applyHeadlights(d);
      this._darkness = d;
      this._fx.update(dt, ph, {
        braking,
        darkness: this._darkness,
        nightLights: this._auto ? 1 : this._night,
        ambient: 1 - 0.82 * this._darkness,
      });
    }
  }
}

const NO_INPUT = Object.freeze({ throttle: 0, brake: 0, steer: 0, thrust: 0, pitch: 0, roll: 0, yaw: 0, boost: false, handbrake: false });
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

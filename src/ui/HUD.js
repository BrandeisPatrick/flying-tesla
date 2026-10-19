import { UIDom, theme, injectTheme, injectStyle, Widget, UILayer, Panel, Gauge, Bar, Readout, AttitudeIndicator, GMeter, Badge, Segments, Minimap, Flash, HelpOverlay } from '@vibe/engine/ui';
import * as THREE from 'three';
const { el } = UIDom;

/**
 * HUD — DOM overlay in an EV-dashboard style: the Roadster skin over the engine widget kit (engine/src/ui).
 *
 *   const hud = new HUD(container);
 *   hud.setMinimapData(world.getMinimapData());
 *   hud.update(dt, car.state, car.object3d);   // every frame, from the game loop
 *   hud.flash('FLIGHT MODE'); hud.toggleHelp(); hud.showHelp(false); hud.setVisible(bool); hud.dispose();
 *
 * No requestAnimationFrame of its own. DOM text is throttled to ~15 Hz;
 * SVG / canvas / bar transforms update every frame.
 */

const REGEN = '#3e9bff';
const MAP_PX = 220;

const CONTROLS = [
  ['W / S  ·  ↑ / ↓', 'Throttle / brake'],
  ['A / D  ·  ← / →', 'Steer (ground) · roll (flight)'],
  ['Space', 'Thrust (lift off)'],
  ['Shift', 'Boost'],
  ['Q / E', 'Yaw (flight)'],
  ['I / K  ·  ↑ / ↓ airborne', 'Pitch'],
  ['C', 'Camera mode'],
  ['R', 'Reset car'],
  ['H', 'Toggle this help'],
];
const PAD_CONTROLS = 'Gamepad: left stick steer/pitch · RT throttle · LT brake · A thrust · B boost · Y camera';

// Skin layout (panel sizes and spacing); typography and widgets come from the kit.
const SKIN_CSS = `
.hud-speed{width:260px;padding:14px 16px 16px;display:flex;flex-direction:column;align-items:center}
.hud-boost{width:100%;margin-top:6px}
.hud-flight{width:300px;padding:14px 16px 16px;transition:opacity .5s}
.hud-flight.ground{opacity:.62}
.hud-badge-wrap{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.hud-flight-body{display:flex;gap:14px;align-items:stretch}
.hud-flight-data{flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0}
.hud-vsi{display:flex;align-items:center;gap:8px;margin-top:4px}
.hud-thr{margin-top:12px}
.hud-lift{margin-top:8px}
.hud-map{width:${MAP_PX + 16}px;padding:8px;border-radius:22px}
.hud-tr-panel{width:190px;padding:12px 14px 14px}
.hud-dmg{margin-top:12px}
`;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export class HUD extends Widget {
  /** @param {HTMLElement} [container=document.body] */
  constructor(container) {
    super();
    this.container = container || document.body;
    injectTheme();
    injectStyle('hud-skin', SKIN_CSS);
    this._accent = theme.accent;

    // scratch (no per-frame allocations)
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._qInv = new THREE.Quaternion();
    this._prevVel = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this._accLocal = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._hasPrev = false;

    this._mode = null;
    this._helpVisible = false;
    this._prevSpeed = 0;
    this._regen = 0;
    this._power = 0;

    this._build();
    this.showHelp(true, true);
  }

  // ---------------------------------------------------------------- build
  _build() {
    const layer = this._layer = new UILayer({ parent: this.container, className: 'hud-root' });
    this.root = this.el = layer.el;

    // ---------- bottom-right: speed cluster ----------
    const br = new Panel({ parent: layer, corner: 'br', className: 'hud-speed' });
    this._gauge = new Gauge({ parent: br, width: 220, height: 200, cx: 110, cy: 108, radius: 88, sweep: 240, ticks: 12, majorEvery: 3, centerTop: 30, footer: 'POWER' });
    this._prnd = new Segments({ parent: this._gauge.center, items: ['P', 'R', 'N', 'D'] });
    this._speed = new Readout({ parent: this._gauge.center, contents: true, size: 'xl', value: '0', unitLabel: 'km/h', sub: '0 mph' });
    this._boost = new Bar({ parent: br, className: 'hud-boost', label: 'Boost', text: '100%', fill: 'linear-gradient(90deg,#ff6a3d,var(--ui-accent))' });

    // ---------- bottom-left: flight panel ----------
    const bl = this._flightPanel = new Panel({ parent: layer, corner: 'bl', className: 'hud-flight ground' });
    const bw = el('div', 'hud-badge-wrap', bl.el);
    this._badge = new Badge({ parent: bw, text: 'GROUND' });
    el('span', 'ui-label', bw, 'Flight systems');
    const body = el('div', 'hud-flight-body', bl.el);
    this._adi = new AttitudeIndicator({ parent: body, size: 112 });
    const data = el('div', 'hud-flight-data', body);
    this._alt = new Readout({ parent: data, contents: true, label: 'Altitude AGL', unit: 'm', value: '0', size: 'lg' });
    const vsi = el('div', 'hud-vsi', data);
    this._vsi = new Bar({ parent: vsi, vertical: true, bipolar: true, length: 42, thickness: 6 });
    this._vs = new Readout({ parent: vsi, label: 'V/S', value: '0.0 m/s', size: 'sm' });
    this._thr = new Bar({ parent: bl, className: 'hud-thr', label: 'Thruster pressure', text: '100%', thickness: 6, fill: 'linear-gradient(90deg,#7fd3ff,#d9f2ff)' });
    this._lift = new Bar({ parent: bl, className: 'hud-lift', label: 'Lift thrust', text: '0%', fill: 'rgba(255,255,255,.75)' });

    // ---------- top-left: minimap ----------
    const tl = new Panel({ parent: layer, corner: 'tl', className: 'hud-map' });
    this._minimap = new Minimap({ parent: tl, size: MAP_PX, footLeft: '200 m', footRight: 'N 000°' });
    layer.onScale((s) => this._minimap.setScale(s));

    // ---------- top-right: G-meter + damage ----------
    const tr = new Panel({ parent: layer, corner: 'tr', className: 'hud-tr-panel' });
    this._gmeter = new GMeter({ parent: tr, label: 'G-force' });
    this._dmg = new Bar({ parent: tr, className: 'hud-dmg', label: 'Integrity', text: '100%', fill: theme.ok });

    // ---------- centre: flash + help ----------
    this._flash = new Flash({ parent: layer });
    this._help = new HelpOverlay({
      parent: layer, title: 'ROADSTER <b>·</b> CONTROLS', subtitle: 'Electric hypercar · cold-gas thruster package',
      rows: CONTROLS, footnote: PAD_CONTROLS, hint: 'PRESS <kbd>H</kbd> TO HIDE',
    });
  }

  // ---------------------------------------------------------------- minimap data
  /** data: { roads: [[ [x,z], ... ], ...], bounds: {minX,maxX,minZ,maxZ} } */
  setMinimapData(data) { this._minimap.setData(data); }

  // ---------------------------------------------------------------- public API
  showHelp(on, _initial) {
    this._helpVisible = !!on;
    this._help.show(this._helpVisible);
  }
  toggleHelp() { this.showHelp(!this._helpVisible); return this._helpVisible; }
  get helpVisible() { return this._helpVisible; }

  flash(msg) { this._flash.show(msg); }

  setVisible(on) { this.root.style.display = on ? '' : 'none'; }

  dispose() { this._layer.dispose(); }

  // ---------------------------------------------------------------- per frame
  update(dt, s, obj) {
    if (!s) return;
    dt = clamp(dt || 0, 0, 0.1);
    const speedKmh = Math.abs(s.speedKmh || 0);
    const vel = s.velocity;
    const flight = s.mode === 'flight';
    const ACCENT = this._accent;

    // orientation vectors
    let pitchDeg = 0, bankDeg = 0, headingDeg = 0, fwdSpeed = 0;
    if (obj) {
      const q = obj.quaternion;
      this._fwd.set(0, 0, -1).applyQuaternion(q);
      this._right.set(1, 0, 0).applyQuaternion(q);
      this._up.set(0, 1, 0).applyQuaternion(q);
      pitchDeg = Math.asin(clamp(this._fwd.y, -1, 1)) * 57.2958;
      bankDeg = Math.atan2(-this._right.y, this._up.y) * 57.2958;
      headingDeg = (Math.atan2(this._fwd.x, -this._fwd.z) * 57.2958 + 360) % 360;
      if (vel) fwdSpeed = vel.dot(this._fwd);
    }

    // acceleration in car frame for G-meter + regen detection
    if (vel) {
      if (this._hasPrev && dt > 0) {
        this._tmp.copy(vel).sub(this._prevVel).divideScalar(dt);
        if (this._tmp.lengthSq() > 150 * 150) this._tmp.set(0, 0, 0);
        this._acc.lerp(this._tmp, 1 - Math.exp(-8 * dt));
      }
      this._prevVel.copy(vel);
      this._hasPrev = true;
    }
    if (obj) {
      this._qInv.copy(obj.quaternion).invert();
      this._accLocal.copy(this._acc).applyQuaternion(this._qInv);
    } else this._accLocal.copy(this._acc);

    // ----- power / regen arc -----
    const rpm = clamp(s.rpmLike || 0, 0, 1);
    const decel = dt > 0 ? (this._prevSpeed - speedKmh / 3.6) / dt : 0;
    this._prevSpeed = speedKmh / 3.6;
    const regenTarget = (s.grounded !== false && speedKmh > 3 && rpm < 0.12 && decel > 1.5) ? clamp(decel / 25, 0.08, 1) : 0;
    this._regen += (regenTarget - this._regen) * (1 - Math.exp(-10 * dt));
    this._power += (rpm - this._power) * (1 - Math.exp(-14 * dt));
    const regen = this._regen > 0.04;
    const arcVal = regen ? this._regen : this._power;
    this._gauge.setValue(arcVal);
    const arcColor = regen ? REGEN : (this._power > 0.9 ? ACCENT : '#ffffff');
    this._gauge.setColor(arcColor, regen ? 'drop-shadow(0 0 6px rgba(62,155,255,.7))'
      : arcColor === ACCENT ? `drop-shadow(0 0 7px rgba(${theme.accentRgb},.8))` : 'drop-shadow(0 0 6px rgba(255,255,255,.35))');

    // ----- bars (every frame) -----
    const boost = clamp(s.boostLevel ?? 1, 0, 1);
    this._boost.setValue(boost);
    const thrLvl = clamp(s.thrusterLevel ?? 1, 0, 1);
    this._thr.setValue(thrLvl);
    const thrust = clamp(s.thrust || 0, 0, 1);
    this._lift.setValue(thrust);
    const damage = clamp(s.damage || 0, 0, 1);
    this._dmg.setValue(1 - damage);
    const vs = vel ? vel.y : 0;
    this._vsi.setValue(clamp(vs / 20, -1, 1));

    // ----- attitude indicator -----
    this._adi.set(pitchDeg, bankDeg);

    // ----- G-meter dot -----
    this._gmeter.update(dt, this._accLocal.x / 9.81, -this._accLocal.z / 9.81);   // lateral (+right), longitudinal (+accel)

    // ----- mode badge / panel state (immediate) -----
    if (s.mode !== this._mode) {
      const first = this._mode === null;
      this._mode = s.mode;
      this._badge.set(flight ? 'FLIGHT' : 'GROUND', flight, { animate: !first });
      this._flightPanel.el.classList.toggle('ground', !flight);
    }
    this._thr.setWarn(thrLvl < 0.2);

    // ----- minimap (every frame): ~360 m across on the ground, wider in flight / at speed -----
    this._minimap.update(dt, {
      x: obj ? obj.position.x : 0, z: obj ? obj.position.z : 0, headingDeg,
      viewM: (flight ? 720 : 360) + Math.min(speedKmh, 300) * 0.6, playerColor: flight ? '#ffffff' : ACCENT,
    });

    // ----- throttled text -----
    if (this.tickText(dt)) {
      const sp = Math.round(speedKmh);
      this._speed.set(String(sp));
      this._speed.setSub(`${Math.round(speedKmh * 0.621371)} mph`);
      this._boost.setText(`${Math.round(boost * 100)}%`);
      this._gauge.setFooter(regen ? 'REGEN' : `POWER ${Math.round(this._power * 100)}%`);
      const alt = Math.max(0, s.altitude || 0);
      this._alt.set(alt < 100 ? alt.toFixed(1) : String(Math.round(alt)));
      this._vs.set(`${vs >= 0 ? '+' : '−'}${Math.abs(vs).toFixed(1)} m/s`);
      this._thr.setText(`${Math.round(thrLvl * 100)}%`);
      this._lift.setText(`${Math.round(thrust * 100)}%`);
      this._gmeter.setValueText((s.gForce ?? this._gmeter.magnitude).toFixed(1));
      this._dmg.setText(`${Math.round((1 - damage) * 100)}%`);
      const hd = Math.round(headingDeg) % 360;
      const card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(headingDeg / 45) % 8];
      this._minimap.setFoot(`View ${Math.round(this._minimap.viewMeters / 10) * 10} m`, `${card} ${String(hd).padStart(3, '0')}°`);
      this._dmg.setColor(damage > 0.66 ? ACCENT : damage > 0.33 ? '#ffb057' : '#4cd27a');
      // gear letter
      this._prnd.select(speedKmh < 0.5 && rpm < 0.02 ? 'P' : fwdSpeed < -0.5 ? 'R' : 'D');
    }
  }
}

export default HUD;

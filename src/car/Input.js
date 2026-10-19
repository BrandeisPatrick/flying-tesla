// Keyboard + Gamepad (+ touch on phones) input, normalised for the Car.
// Thin game shim over the engine's VehicleInput preset (engine/src/input/VehicleInput.js), which is an
// action map on engine/src/input/InputMap.js. Same fields and behaviour as before:
//   throttle, brake, steer, thrust, pitch, roll, yaw (analog); boost, handbrake, lookBack (bool);
//   toggleCamera, reset, toggleHelp (edges); setFlightMode(on) remaps ↑/↓ to pitch while airborne.
// On-screen touch controls appear automatically on touch-first devices; ?touch=1 forces them, ?touch=0 hides them.
import { VehicleInput } from '@vibe/engine/input';

function touchOption() {
  if (typeof window === 'undefined' || !window.location) return 'auto';
  const p = new URLSearchParams(window.location.search).get('touch');
  return p == null ? 'auto' : p !== '0';
}

export class Input extends VehicleInput {
  constructor(domElement = null, opts = {}) {
    super(domElement, { touch: touchOption(), ...opts });
  }
}

/**
 * CarAudio — Web Audio synthesis (no sample files).
 * Thin game shim over the engine's VehicleAudio (engine/src/audio/VehicleAudio.js: AudioBus mixer + Synth
 * voices + CityAmbience bed). Same API as before:
 *
 *   const audio = new CarAudio();
 *   // inside a user-gesture handler (keydown / pointerdown):
 *   audio.start();              // idempotent; creates the graph once, resumes the context
 *   audio.update(dt, car.state) // every frame
 *   audio.setMuted(bool); audio.setVolume(0..1); audio.toggleMute(); audio.impact(0..1); audio.running
 *   audio.setEnvironment({ nearWater, darkness })   // optional: drives the ambience (gulls / night)
 *
 * Layers: EV motor whine, inverter whistle, tyre slip, wind, thruster roar + hiss, impact thump, ambience.
 */
import { VehicleAudio } from '@vibe/engine/audio';

export class CarAudio extends VehicleAudio {
  constructor(opts = {}) {
    super({ topSpeed: 400 / 3.6, ...opts });
  }
}

export default CarAudio;

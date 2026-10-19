/**
 * ChaseCamera — smooth third-person / hood / cockpit / cinematic camera with occlusion avoidance.
 * Thin game shim: the implementation is the engine's ChaseRig (engine/src/camera/ChaseRig.js) whose defaults
 * are the Roadster tuning; occlusion/ground utilities live in engine/src/camera/CameraRig.js.
 *
 * Contract (ARCHITECTURE.md):
 *   new ChaseCamera(camera, domElement, {
 *     minY = 0.6,                 camera never closer than this to the ground
 *     getGroundHeight?(x,z,y),    world.getGroundHeight
 *     queryColliders?(x,z,r),     world.queryColliders -> AABBs {minX..maxZ, kind}: 1 building, 2 tree trunk,
 *                                 3 pole, 4 parked car, 5 bridge pier, 'vehicle' traffic
 *     physics?,                   or an engine PhysicsWorld (getGroundHeight / queryColliders / raycast)
 *     offsets?: { hood, cockpit } local-space Vector3 overrides
 *     occlusion = true,           pull the camera in front of obstacles / out of tree canopies
 *   })
 *   setTarget(carObject3d, carStateGetter)
 *   cycleMode()            chase -> hood -> cockpit -> cinematic -> chase
 *   setLookBack(bool)
 *   update(dt)
 *   snap()                 teleport to ideal pose (call after car reset)
 *   mode                   'chase' | 'hood' | 'cockpit' | 'cinematic' (get/set)
 */
import { ChaseRig } from '@vibe/engine/camera';

export class ChaseCamera extends ChaseRig {
  constructor(camera, domElement, opts = {}) {
    super(camera, domElement, opts);
  }
}

export default ChaseCamera;

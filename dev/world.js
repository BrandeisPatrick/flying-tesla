// Dev viewer for the World module: OrbitControls camera + stats (incl. building-tile streaming; ?nostream=1 builds
// everything at load). Served by Vite at /dev/world.html
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World } from '../src/world/World.js';

const qs = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(qs.get('exp') || 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 20000);
camera.position.set(180, 140, 220);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

const hud = document.getElementById('hud');
const t = qs.get('t');
const world = new World(scene, renderer, { timeOfDay: t ? (isNaN(+t) ? t : +t) : 'golden', forceProcedural: qs.get('procedural') === '1' });
window.__world = world;
window.__three = { scene, camera, renderer, controls, THREE };

const marker = new THREE.Mesh(new THREE.ConeGeometry(1.2, 4, 12).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe82127, emissive: 0x400000 }));
scene.add(marker);

await world.load((f, label) => { hud.textContent = `loading ${(f * 100) | 0}%  ${label}`; });
const sp = world.getSpawn();
marker.position.copy(sp.position).add(new THREE.Vector3(0, 2.5, 0));
marker.rotation.y = sp.headingRad;
const cam = qs.get('cam');
if (cam) {
  const v = cam.split(',').map(Number);
  camera.position.set(v[0], v[1], v[2]); controls.target.set(v[3] || 0, v[4] || 0, v[5] || 0);
} else {
  const back = new THREE.Vector3(Math.sin(sp.headingRad), 0, Math.cos(sp.headingRad));
  camera.position.copy(sp.position).addScaledVector(back, 60).add(new THREE.Vector3(0, 35, 0));
  controls.target.copy(sp.position);
}

const presets = ['dawn', 'morning', 'noon', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];
addEventListener('keydown', (e) => {
  const i = Number(e.key) - 1;
  if (i >= 0 && i < presets.length) world.setTimeOfDay(presets[i]);
  if (e.key === 'g') console.log('ground', world.getGroundHeight(controls.target.x, controls.target.z), 'colliders', world.queryColliders(controls.target.x, controls.target.z, 10).length);
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

/** Building-tile streaming: resident tiles per layer, MB, this frame's build ms (max so far), queue, pop-in log. */
function streamLine() {
  const T = world.buildingTiles, S = world.streamer.stats, L = world.streamLog || {};
  return `tiles: district ${T.district.built}/${T.district.of}  detail ${T.detail.built}/${T.detail.of}  filler ${T.filler.built}/${T.filler.of}  ` +
    `${T.residentMB} MB  build ${S.msThisFrame.toFixed(1)} ms (max ${S.maxMsFrame.toFixed(1)})  pending ${S.pending}  built ${S.builds}+${S.upgrades}  freed ${S.disposed}  ` +
    `nearest new tile ${Number.isFinite(L.minDist) ? L.minDist.toFixed(0) + ' m' : '-'}  late detail ${L.lateDetail ?? 0}/${L.detailCommits ?? 0}`;
}

const clock = new THREE.Clock();
let fpsT = 0, frames = 0, fps = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  controls.update();
  world.update(dt, camera.position);
  renderer.render(scene, camera);
  frames++; fpsT += dt;
  if (fpsT > 0.5) {
    fps = frames / fpsT; frames = 0; fpsT = 0;
    const i = renderer.info.render;
    hud.textContent = `fps ${fps.toFixed(0)}  calls ${i.calls}  tris ${(i.triangles / 1e6).toFixed(2)}M\n` +
      `source ${world.stats.source}  buildings ${world.stats.buildings} (+${world.stats.fillerBuildings} filler)\n` +
      `roads ${world.stats.roads}  bridges ${world.stats.bridges}  trees ${world.stats.trees}  lamps ${world.stats.lamps}\n` +
      `signals ${world.stats.signals}  cars ${world.stats.parkedCars}  colliders ${world.stats.colliders}  load ${world.stats.loadMs}ms\n` +
      (world.streamer ? streamLine() + '\n' : 'streaming off (?nostream=1)\n') +
      `time ${world.timeOfDay.toFixed(2)}h  cam ${camera.position.x.toFixed(0)},${camera.position.y.toFixed(0)},${camera.position.z.toFixed(0)}  ` +
      `ground@target ${world.getGroundHeight(controls.target.x, controls.target.z).toFixed(2)}`;
  }
});

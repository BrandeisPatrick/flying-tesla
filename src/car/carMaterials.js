// PBR materials for the hero car. Paint/glass/chrome react to scene.environment (PMREM of the sky);
// Car.js can pin them to the environment with a boost (see Car._syncEnv).
import * as THREE from 'three';
import * as TX from './carTextures.js';

/**
 * Glass that keeps full-strength reflections while letting the interior show through:
 * premultiplied output = diffuse * alpha + specular (specular is not scaled by opacity).
 */
function reflectiveGlass(params) {
  const m = new THREE.MeshPhysicalMaterial(params);
  m.premultipliedAlpha = true;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <opaque_fragment>', `
        float gA = clamp( diffuseColor.a, 0.0, 1.0 );
        float gSpec = gl_FrontFacing ? 1.0 : 0.3;   // seen from the cockpit: keep the view out clear
        gl_FragColor = vec4( totalDiffuse * gA + ( outgoingLight - totalDiffuse ) * gSpec, gA );`)
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  m.customProgramCacheKey = () => 'roadster-glass-premul';
  return m;
}

export function createMaterials() {
  const flake = TX.flakeNormalTexture();
  const cf = TX.carbonTextures();
  const grille = TX.grilleTexture();
  const disc = TX.discTexture();
  const screen = TX.screenTexture();
  const cluster = TX.clusterTexture();
  const plate = TX.plateTexture();
  const V2 = (a, b) => new THREE.Vector2(a, b);

  const m = {
    // metallic red multi-coat: flake normals on the base, mirror-smooth clearcoat on top
    paint: new THREE.MeshPhysicalMaterial({
      name: 'paint', color: 0x8e0912, metalness: 0.5, roughness: 0.3,
      clearcoat: 1, clearcoatRoughness: 0.05,
      normalMap: flake, normalScale: V2(0.18, 0.18),
      specularIntensity: 1, ior: 1.5,
    }),
    carbon: new THREE.MeshPhysicalMaterial({
      name: 'carbon', color: cf ? 0xffffff : 0x17181b, map: cf ? cf.map : null,
      normalMap: cf ? cf.normalMap : null, normalScale: V2(0.6, 0.6),
      roughnessMap: cf ? cf.roughnessMap : null, roughness: 0.8, metalness: 0.2,
      clearcoat: 0.35, clearcoatRoughness: 0.18,
    }),
    glass: reflectiveGlass({
      name: 'glass', color: 0x0d1216, metalness: 0, roughness: 0.03, opacity: 0.2, transparent: true,
      side: THREE.DoubleSide, depthWrite: false, specularIntensity: 1, ior: 1.52,
    }),
    lens: new THREE.MeshPhysicalMaterial({ name: 'lens', color: 0x08090b, metalness: 0.4, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 }),
    tailLens: new THREE.MeshPhysicalMaterial({ name: 'tailLens', color: 0x2a0204, metalness: 0.2, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x500000, emissiveIntensity: 0.3 }),
    trim: new THREE.MeshPhysicalMaterial({ name: 'trim', color: 0x050506, metalness: 0.1, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }),
    fascia: new THREE.MeshPhysicalMaterial({ name: 'fascia', color: 0x0b0b0c, metalness: 0.05, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.25 }),
    seam: new THREE.MeshStandardMaterial({ name: 'seam', color: 0x010101, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    chrome: new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xe6eaee, metalness: 1, roughness: 0.07 }),
    satin: new THREE.MeshStandardMaterial({ name: 'satin', color: 0x3c3f44, metalness: 0.9, roughness: 0.32 }),
    mirror: new THREE.MeshStandardMaterial({ name: 'mirror', color: 0xb8c0c8, metalness: 1, roughness: 0.02 }),
    tyre: new THREE.MeshStandardMaterial({ name: 'tyre', color: 0x1b1c1d, roughness: 0.86, metalness: 0 }),
    tyreWall: new THREE.MeshStandardMaterial({ name: 'tyreWall', color: 0x222325, roughness: 0.78, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ name: 'rim', color: 0xc9cdd2, metalness: 1, roughness: 0.2 }),
    rimDark: new THREE.MeshStandardMaterial({ name: 'rimDark', color: 0x2c2e32, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ name: 'disc', color: 0xffffff, map: disc, metalness: 0.9, roughness: 0.42, emissive: 0xff4a12, emissiveIntensity: 0 }),
    discHat: new THREE.MeshStandardMaterial({ name: 'discHat', color: 0x2b2c30, metalness: 0.7, roughness: 0.45 }),
    caliper: new THREE.MeshPhysicalMaterial({ name: 'caliper', color: 0xc8101a, metalness: 0.1, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.1 }),
    nozzle: new THREE.MeshStandardMaterial({ name: 'nozzle', color: 0x8d9198, metalness: 1, roughness: 0.28, emissive: 0x4f8dff, emissiveIntensity: 0, side: THREE.DoubleSide }),
    nozzleIn: new THREE.MeshStandardMaterial({ name: 'nozzleIn', color: 0x121418, metalness: 0.8, roughness: 0.4, emissive: 0x9cc8ff, emissiveIntensity: 0, side: THREE.BackSide }),
    liner: new THREE.MeshStandardMaterial({ name: 'liner', color: 0x0c0d0f, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    grille: new THREE.MeshStandardMaterial({ name: 'grille', color: 0xffffff, map: grille, roughness: 0.6, metalness: 0.3 }),
    interior: new THREE.MeshStandardMaterial({ name: 'interior', color: 0x1e1f22, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }),
    leather: new THREE.MeshStandardMaterial({ name: 'leather', color: 0xe3ddd2, roughness: 0.55, metalness: 0 }),
    leatherDark: new THREE.MeshStandardMaterial({ name: 'leatherDark', color: 0x161719, roughness: 0.58, metalness: 0 }),
    carpet: new THREE.MeshStandardMaterial({ name: 'carpet', color: 0x121315, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
    screen: new THREE.MeshStandardMaterial({ name: 'screen', color: 0x050608, roughness: 0.12, metalness: 0, map: null, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: screen ? 0.55 : 0.2 }),
    cluster: new THREE.MeshStandardMaterial({ name: 'cluster', color: 0x050608, roughness: 0.12, metalness: 0, emissive: 0xffffff, emissiveMap: cluster, emissiveIntensity: cluster ? 0.5 : 0.2 }),
    plate: new THREE.MeshStandardMaterial({ name: 'plate', color: plate ? 0xffffff : 0xdddddd, map: plate, roughness: 0.45, metalness: 0.1 }),
    // lights (emissive intensities > 1 are bloom-ready; Car.js animates them)
    ambient: new THREE.MeshStandardMaterial({ name: 'ambient', color: 0x000000, emissive: 0xb8d4ff, emissiveIntensity: 0.6, roughness: 0.5 }),
    drl: new THREE.MeshStandardMaterial({ name: 'drl', color: 0xffffff, emissive: 0xf2f7ff, emissiveIntensity: 4.5, roughness: 0.2 }),
    headLens: new THREE.MeshStandardMaterial({ name: 'headLens', color: 0x9aa4b0, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.05, metalness: 0.6 }),
    tail: new THREE.MeshStandardMaterial({ name: 'tail', color: 0x3a0000, emissive: 0xff1a1a, emissiveIntensity: 2.2, roughness: 0.3 }),
    brake: new THREE.MeshStandardMaterial({ name: 'brake', color: 0x300000, emissive: 0xff0c0c, emissiveIntensity: 0.15, roughness: 0.3 }),
    reverse: new THREE.MeshStandardMaterial({ name: 'reverse', color: 0x1a1a1a, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 }),
  };
  m.shelf = m.carbon;
  return m;
}

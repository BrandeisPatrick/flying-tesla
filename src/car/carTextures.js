// Procedural canvas textures for the hero car and its effects (browser only; every
// function returns null in Node so the mesh builder still runs headless).
import * as THREE from 'three';

const HAS_DOM = typeof document !== 'undefined';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function tex(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = aniso;
  return t;
}
// height field -> tangent-space normal map canvas
function normalFromHeight(h, N, strength) {
  const c = canvas(N, N), g = c.getContext('2d');
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hl = h[y * N + ((x - 1 + N) % N)], hr = h[y * N + ((x + 1) % N)];
    const hu = h[((y - 1 + N) % N) * N + x], hd = h[((y + 1) % N) * N + x];
    let nx = (hl - hr) * strength, ny = (hd - hu) * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * N + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Metallic-flake micro normals for the base coat (clearcoat stays on the smooth geometry normal). */
export function flakeNormalTexture() {
  if (!HAS_DOM) return null;
  const N = 256, c = canvas(N, N), g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const r = rng(91);
  for (let i = 0; i < N * N; i++) {
    const a = r() * Math.PI * 2, t = Math.pow(r(), 2.2) * 0.55;
    const nx = Math.cos(a) * t, ny = Math.sin(a) * t, nz = Math.sqrt(1 - t * t);
    img.data[i * 4] = (nx * 0.5 + 0.5) * 255; img.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: [7, 7], aniso: 4 });
}

/** 2x2 twill carbon weave: { map, normalMap, roughnessMap } with UVs in metres (repeat ~ 1 cell / 6 mm). */
export function carbonTextures() {
  if (!HAS_DOM) return null;
  const N = 128, TOW = 8; // 16 tows across the tile
  const h = new Float32Array(N * N), col = canvas(N, N), rough = canvas(N, N);
  const gc = col.getContext('2d'), gr = rough.getContext('2d');
  const ic = gc.createImageData(N, N), ir = gr.createImageData(N, N);
  const r = rng(7);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = Math.floor(x / TOW), j = Math.floor(y / TOW);
    const warp = ((i - j) & 3) < 2;                 // 2x2 twill: warp over for two cells
    const fx = (x % TOW + 0.5) / TOW, fy = (y % TOW + 0.5) / TOW;
    const across = warp ? fx : fy, along = warp ? fy : fx;
    const bump = Math.sin(Math.PI * across);         // rounded tow cross-section
    const dip = 0.85 + 0.15 * Math.sin(Math.PI * along);
    const fib = 0.92 + 0.08 * Math.sin((warp ? x : y) * 2.7 + r() * 0.6); // fibre streaks
    h[y * N + x] = bump * dip;
    const base = warp ? 36 : 20;                      // anisotropic sheen: warp tows read lighter
    const v = base * (0.55 + 0.45 * bump) * fib;
    const k = (y * N + x) * 4;
    ic.data[k] = v * 0.94; ic.data[k + 1] = v * 0.97; ic.data[k + 2] = v * 1.05; ic.data[k + 3] = 255;
    const rv = 70 + 60 * (1 - bump);
    ir.data[k] = ir.data[k + 1] = ir.data[k + 2] = rv; ir.data[k + 3] = 255;
  }
  gc.putImageData(ic, 0, 0); gr.putImageData(ir, 0, 0);
  const rep = [20, 20];
  return {
    map: tex(col, { repeat: rep }),
    normalMap: tex(normalFromHeight(h, N, 2.2), { srgb: false, repeat: rep }),
    roughnessMap: tex(rough, { srgb: false, repeat: rep }),
  };
}

/** Honeycomb mesh for intakes. */
export function grilleTexture() {
  if (!HAS_DOM) return null;
  const W = 64, H = 56, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#060607'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2a2c30'; g.lineWidth = 3;
  const hex = (cx, cy, r) => {
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    g.closePath(); g.stroke();
  };
  for (let row = -1; row < 3; row++) for (let col = -1; col < 3; col++) hex(col * 32 + (row & 1) * 16, row * 28, 16);
  return tex(c, { repeat: [1, 1] });
}

/** Brake disc face (planar UV of a RingGeometry): ground friction band with drilled holes. */
export function discTexture() {
  if (!HAS_DOM) return null;
  const N = 256, c = canvas(N, N), g = c.getContext('2d');
  const cx = N / 2, R = N / 2;
  g.fillStyle = '#5c5f63'; g.fillRect(0, 0, N, N);
  const r = rng(3);
  for (let k = 0; k < 900; k++) { // circumferential grinding marks
    const rr = R * (0.52 + 0.47 * r()), a = r() * Math.PI * 2, l = 0.2 + r() * 0.6;
    g.strokeStyle = `rgba(${150 + r() * 60 | 0},${150 + r() * 60 | 0},${155 + r() * 60 | 0},0.12)`;
    g.lineWidth = 1; g.beginPath(); g.arc(cx, cx, rr, a, a + l); g.stroke();
  }
  g.fillStyle = '#16171a';
  for (let k = 0; k < 24; k++) for (let m = 0; m < 3; m++) {
    const a = (k / 24) * Math.PI * 2 + m * 0.07, rr = R * (0.64 + m * 0.11);
    g.beginPath(); g.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, 3.2, 0, Math.PI * 2); g.fill();
  }
  return tex(c);
}

/** Centre touchscreen UI (landscape) — used as map + emissiveMap. */
export function screenTexture() {
  if (!HAS_DOM) return null;
  const W = 512, H = 288, c = canvas(W, H), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1018'); bg.addColorStop(1, '#05070b');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // map pane
  g.fillStyle = '#121a26'; g.fillRect(170, 10, 332, 268);
  g.strokeStyle = '#26364c'; g.lineWidth = 6;
  for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(170, 30 + k * 40); g.lineTo(502, 10 + k * 46); g.stroke(); }
  for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(190 + k * 60, 10); g.lineTo(210 + k * 52, 278); g.stroke(); }
  g.strokeStyle = '#3d8bff'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(330, 270); g.lineTo(345, 180); g.lineTo(420, 120); g.lineTo(470, 30); g.stroke();
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(330, 236); g.lineTo(342, 262); g.lineTo(318, 262); g.closePath(); g.fill();
  // car pane
  g.fillStyle = '#e8ecf2'; g.font = 'bold 64px -apple-system, Helvetica, Arial, sans-serif';
  g.fillText('0', 30, 92);
  g.font = '20px -apple-system, Helvetica, Arial, sans-serif'; g.fillStyle = '#8a95a6';
  g.fillText('MPH', 34, 120);
  g.fillStyle = '#c3121b'; g.fillRect(30, 150, 110, 6);
  g.fillStyle = '#8a95a6'; g.fillText('P R N D', 30, 196);
  g.fillStyle = '#3ddc84'; g.fillRect(30, 230, 92, 14);
  g.strokeStyle = '#8a95a6'; g.lineWidth = 2; g.strokeRect(30, 230, 120, 14);
  // bottom bar
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 262, 170, 26);
  return tex(c, { aniso: 4 });
}

/** Small driver display behind the yoke. */
export function clusterTexture() {
  if (!HAS_DOM) return null;
  const W = 256, H = 88, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#05070b'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8ecf2'; g.font = 'bold 44px -apple-system, Helvetica, Arial, sans-serif';
  g.textAlign = 'center'; g.fillText('0', W / 2, 56);
  g.fillStyle = '#3d8bff'; g.fillRect(20, 70, 70, 5);
  g.fillStyle = '#3ddc84'; g.fillRect(166, 70, 70, 5);
  return tex(c, { aniso: 4 });
}

/** Rear licence plate. */
export function plateTexture() {
  if (!HAS_DOM) return null;
  const W = 256, H = 128, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#eceff2'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2b2f36'; g.lineWidth = 6; g.strokeRect(5, 5, W - 10, H - 10);
  g.fillStyle = '#c3121b'; g.font = 'bold 18px Helvetica, Arial, sans-serif'; g.textAlign = 'center';
  g.fillText('CALIFORNIA', W / 2, 32);
  g.fillStyle = '#1a2a6a'; g.font = 'bold 54px Helvetica, Arial, sans-serif';
  g.fillText('7ROADST', W / 2, 96);
  return tex(c, { aniso: 4 });
}

/** Soft radial glow (additive sprites, halos, plume diamonds). */
export function glowTexture() {
  if (!HAS_DOM) return null;
  const N = 64, c = canvas(N, N), g = c.getContext('2d');
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  return tex(c, { srgb: false, aniso: 1 });
}

/** Soft round smoke/dust puff with wispy internal variation (white RGB, shape in alpha). */
export function puffTexture() {
  if (!HAS_DOM) return null;
  const N = 128, c = canvas(N, N), g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const r = rng(17);
  const waves = Array.from({ length: 7 }, () => [r() * 9 + 3, r() * 9 + 3, r() * 6.283, 0.3 + r() * 0.7]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N - 0.5, v = (y + 0.5) / N - 0.5;
    const d = Math.hypot(u, v) * 2;
    let nse = 0, wsum = 0;
    for (const [fx, fy, ph, w] of waves) { nse += w * Math.sin(u * fx * 3.1 + ph) * Math.sin(v * fy * 3.1 - ph * 0.7); wsum += w; }
    nse = 0.5 + 0.5 * (nse / wsum);
    const t = Math.min(1, Math.max(0, (d - 0.15) / 0.85));
    const fall = 1 - t * t * (3 - 2 * t);
    const i = (y * N + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(255 * fall * fall * (0.45 + 0.55 * nse));
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, aniso: 1 });
}

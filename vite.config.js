import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));

// BASE_PATH=/roadster/ builds for GitHub Pages (project site under a sub-path); every asset URL in the game and
// the engine goes through import.meta.env.BASE_URL, so nothing else changes.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  server: { port: 5180, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: root('./index.html') } }, // the engine samples live in engine/samples (engine repo)
  },
});

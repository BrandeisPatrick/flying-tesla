import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  server: { port: 5180, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: root('./index.html') } }, // the engine samples live in engine/samples (engine repo)
  },
});

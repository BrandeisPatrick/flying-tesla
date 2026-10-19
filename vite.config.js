import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  server: { port: 5180, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      // main game stays the default entry; engine samples are extra pages (served at /samples/<name>/ in dev too)
      input: {
        main: root('./index.html'),
        'canyon-run': root('./samples/canyon-run/index.html'),
      },
    },
  },
});

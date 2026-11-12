import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// In dev the browser only talks to this port; /ws is proxied to the room server so a devbox
// behind a single forwarded port works.
// Two pages: the world, and the guide at /guide/.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        guide: fileURLToPath(new URL('guide/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': {
        target: process.env.ROOM_SERVER_URL ?? 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

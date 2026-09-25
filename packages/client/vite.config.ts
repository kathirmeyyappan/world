import { defineConfig } from 'vite';

// In dev the browser only talks to this port; /ws is proxied to the room server so a devbox
// behind a single forwarded port works.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
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

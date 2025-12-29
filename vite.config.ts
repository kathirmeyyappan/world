import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: '/world/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
    open: true,
  },
});


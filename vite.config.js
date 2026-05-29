// vite.config.js
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  base: './',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { main: path.resolve(__dirname, 'index.html') },
      output: {
        manualChunks: {
          indicators: [
            './indicators/engine.js',
            './indicators/regime.js',
            './indicators/structure.js',
          ],
          services: [
            './services/exchange.js',
            './services/screener.js',
          ],
        },
      },
    },
  },

  worker: {
    format: 'es',
  },

  server: {
    port: 3000,
    open: true,
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});

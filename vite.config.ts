import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const ROOT = import.meta.dirname;

export default defineConfig({
  build: {
    // Rapier's compat build embeds its WASM as base64, so one large chunk is expected.
    chunkSizeWarningLimit: 6000,
    // Only the game is built; lab/ pages are development tools served by `vite`.
    rollupOptions: { input: resolve(ROOT, 'index.html') },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as any);

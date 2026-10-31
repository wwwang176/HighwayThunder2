import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // Rapier's compat build embeds its WASM as base64, so one large chunk is expected.
    chunkSizeWarningLimit: 6000,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as any);

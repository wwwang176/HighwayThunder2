import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as any);

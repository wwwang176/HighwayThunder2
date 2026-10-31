import { defineConfig } from 'vitest/config';

/**
 * Headless training runs (not part of `npm test`):
 *   npx vitest run --config training/vitest.config.ts
 * Settings come from environment variables, see headless.train.ts.
 */
export default defineConfig({
  test: {
    include: ['training/**/*.train.ts'],
    testTimeout: 24 * 3600 * 1000,
    hookTimeout: 60_000,
  },
});

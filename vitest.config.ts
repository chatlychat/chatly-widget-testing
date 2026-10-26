import { defineConfig } from 'vitest/config';

const vitestExecution = { pool: 'threads' as const };

export default defineConfig({
  test: {
    ...vitestExecution,
    // NODE, not jsdom. The absence of `window` in the default environment is
    // half the proof that this kit needs no browser: `mock.spec.ts` builds its
    // own `localStorage` double rather than borrowing jsdom's, which is also
    // how an integrator would use it from `page.evaluate`.
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // cada arquivo sobe um PGlite e aplica todas as migrations; em paralelo leva mais que 10 s
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // no Postgres real todos os arquivos dividem um banco: em paralelo dão deadlock
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // PGlite leva alguns segundos para subir e aplicar as migrations
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // no Postgres real todos os arquivos dividem um banco: em paralelo dão deadlock
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});

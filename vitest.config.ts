import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/**/*.test.ts', 'shared/**/*.test.ts', 'frontend/src/data/**/*.test.ts'],
    fileParallelism: true,
  },
});

import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['backend/**/*.test.ts','shared/**/*.test.ts','frontend/src/data/**/*.test.ts'], exclude: ['frontend/src/data/repository.test.ts','frontend/src/data/planning-repository.test.ts','frontend/src/data/planning-backup.test.ts'], fileParallelism: true } });

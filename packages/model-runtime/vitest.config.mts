import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      // Resolve @cloud/database's internal @/ paths when pnpm overrides pull in cloud packages
      '@/database': resolve(__dirname, '../../packages/database/src'),
      // TODO: 目前仍然残留 ModelRuntime.test.ts 中的部分测试依赖了主项目的内容，后续需要拆分测试
      '@': resolve(__dirname, '../../src'),
    },
    coverage: {
      exclude: [
        // Vitest 4+ ships an empty `coverageConfigDefaults.exclude`; keep the previous
        // default exclusions explicitly so the coverage set does not silently grow.
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
        '**/types/**',
        '**/type.ts',
        '**/utils/index.ts',
      ],
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
  },
});

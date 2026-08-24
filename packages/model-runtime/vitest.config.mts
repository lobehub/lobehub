import path from 'node:path';

import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      // Resolve @cloud/database's internal @/ paths when pnpm overrides pull in cloud packages
      '@/database': path.resolve(__dirname, '../../packages/database/src'),
      '@/utils/devAuth': path.resolve(__dirname, '../utils/src/devAuth.ts'),
      // TODO: 目前仍然残留 ModelRuntime.test.ts 中的部分测试依赖了主项目的内容，后续需要拆分测试
      '@': path.resolve(__dirname, '../../src'),
    },
    coverage: {
      exclude: [
        ...coverageConfigDefaults.exclude,
        '**/types/**',
        '**/type.ts',
        '**/utils/index.ts',
      ],
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
  },
});

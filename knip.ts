import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/app/**/*.ts{x,}'],
  ignore: [
    // Test files
    'src/**/__tests__/**',
    'src/**/*.test.ts{x,}',
    'src/**/*.spec.ts{x,}',
    // Other directories
    'packages/**',
    'e2e/**',
    'scripts/**',
    // Config files
    '*.config.{js,ts,mjs,cjs}',
    'next-env.d.ts',
  ],
  ignoreDependencies: [],
  ignoreExportsUsedInFile: true,
  project: ['src/**/*.ts{x,}'],
};

export default config;

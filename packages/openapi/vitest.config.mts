import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

/**
 * Root tsconfig maps these prefixes to a package first and the app `src` second.
 * Vite aliases have no fallback, so resolve the app-level module when the
 * package does not have it (the spec test imports the whole app).
 */
const FALLBACK_PREFIXES: Record<string, [string, string]> = {
  '@/business/server/': ['../business-server/src/', '../../src/business/server/'],
  '@/config/': ['../app-config/src/', '../../src/config/'],
  '@/const/': ['../const/src/', '../../src/const/'],
  '@/envs/': ['../env/src/', '../../src/envs/'],
  '@/libs/trpc/': ['../trpc/src/', '../../src/libs/trpc/'],
  '@/locales/': ['../locales/src/', '../../src/locales/'],
  '@/types/': ['../types/src/', '../../src/types/'],
  '@/utils/': ['../utils/src/', '../../src/utils/'],
};
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
const exists = (base: string) => EXTENSIONS.some((ext) => existsSync(`${base}${ext}`));

export default defineConfig({
  plugins: [
    {
      enforce: 'pre',
      name: 'tsconfig-path-fallback',
      // Runs after the aliases below, so it sees the package path they produced.
      resolveId(id) {
        for (const [primary, fallback] of Object.values(FALLBACK_PREFIXES)) {
          const primaryDir = resolve(__dirname, primary);
          if (!id.startsWith(`${primaryDir}/`) || exists(id)) continue;
          const candidate = resolve(__dirname, fallback, id.slice(primaryDir.length + 1));
          if (exists(candidate)) return this.resolve(candidate);
        }
      },
    },
    // The spec test imports the whole app, which reaches agent templates that
    // import Markdown; keep Vite from parsing it as JavaScript.
    {
      name: 'raw-md',
      transform(_, id) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
  ],
  resolve: {
    alias: {
      // mirror the root tsconfig paths: package sources first, app src as fallback
      '@/business/server': resolve(__dirname, '../business-server/src'),
      '@/const': resolve(__dirname, '../const/src'),
      '@/config': resolve(__dirname, '../app-config/src'),
      '@/database': resolve(__dirname, '../database/src'),
      '@/envs': resolve(__dirname, '../env/src'),
      '@/libs/trpc': resolve(__dirname, '../trpc/src'),
      '@/locales': resolve(__dirname, '../locales/src'),
      '@/server': resolve(__dirname, '../../apps/server/src'),
      '@/types': resolve(__dirname, '../types/src'),
      // packages/utils has no rbac module; the app-level helper is the real source
      '@/utils/rbac': resolve(__dirname, '../../src/utils/rbac'),
      '@/utils': resolve(__dirname, '../utils/src'),
      '@': resolve(__dirname, '../../src'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});

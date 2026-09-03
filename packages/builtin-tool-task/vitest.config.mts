import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '../..');

export default defineConfig({
  plugins: [
    {
      enforce: 'pre',
      name: 'stub-lobehub-ui-motion-provider',
      resolveId(id, importer) {
        if (!importer || !importer.includes('/@lobehub/ui/')) return null;
        if (/MotionProvider(?:\/index(?:\.(?:mjs|js|tsx))?)?$/.test(id))
          return path.resolve(repoRoot, 'tests/mocks/lobehubUiMotionProvider.tsx');
        return null;
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(repoRoot, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
    server: {
      deps: {
        inline: [/@lobehub\//],
      },
    },
  },
});

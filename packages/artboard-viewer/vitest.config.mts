import path from 'node:path';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The viewer reuses the app's Artboard modules, which import through the root `@/` paths.
  plugins: [tsconfigPaths({ projects: [path.resolve(import.meta.dirname, '../..')] })],
  test: {
    environment: 'node',
  },
});

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = resolve(packageRoot, '../..');

export default defineConfig({
  test: {
    alias: {
      '@': resolve(workspaceRoot, 'src'),
    },
    environment: 'happy-dom',
  },
});

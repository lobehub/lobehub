import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Importing `@lobechat/agent-runtime` pulls in `@lobechat/context-engine`,
    // which reaches `@lobechat/agent-templates` and its `.md` prompt files.
    // Vitest would otherwise try to parse the Markdown as JavaScript. Mirrors
    // the root config's `raw-md` plugin; the content is irrelevant to the CLI.
    {
      name: 'raw-md',
      transform(_code: string, id: string) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: '@lobechat/device-gateway-client',
        replacement: path.resolve(__dirname, '../../packages/device-gateway-client/src/index.ts'),
      },
      {
        find: /^@lobechat\/local-file-shell$/,
        replacement: path.resolve(__dirname, '../../packages/local-file-shell/src/index.ts'),
      },
      {
        find: '@lobechat/file-loaders',
        replacement: path.resolve(__dirname, '../../packages/file-loaders/src/index.ts'),
      },
      {
        find: '@lobechat/tool-runtime',
        replacement: path.resolve(__dirname, '../../packages/tool-runtime/src/index.ts'),
      },
    ],
  },
  test: {
    coverage: {
      all: false,
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Suppress unhandled rejection warnings from Commander async actions with mocked process.exit
    onConsoleLog: () => true,
  },
});

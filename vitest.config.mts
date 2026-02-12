import { dirname, join, resolve } from 'node:path';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: {
    exclude: ['crypto', 'util', 'tty'],
    include: ['@lobehub/tts'],
  },
  plugins: [
    /**
     * @lobehub/fluent-emoji@4.0.0 ships `es/FluentEmoji/style.js` but its `es/FluentEmoji/index.js`
     * imports `./style/index.js` which doesn't exist.
     *
     * In app bundlers this can be tolerated/rewritten, but Vite/Vitest resolves it strictly and
     * fails the whole test run. Redirect it to the real file.
     */
    {
      enforce: 'pre',
      name: 'fix-lobehub-fluent-emoji-style-import',
      resolveId(id, importer) {
        if (!importer) return null;

        const isFluentEmojiEntry =
          importer.endsWith('/@lobehub/fluent-emoji/es/FluentEmoji/index.js') ||
          importer.includes('/@lobehub/fluent-emoji/es/FluentEmoji/index.js?');

        const isMissingStyleIndex =
          id === './style/index.js' ||
          id.endsWith('/@lobehub/fluent-emoji/es/FluentEmoji/style/index.js') ||
          id.endsWith('/@lobehub/fluent-emoji/es/FluentEmoji/style/index.js?') ||
          id.endsWith('/FluentEmoji/style/index.js') ||
          id.endsWith('/FluentEmoji/style/index.js?');

        if (isFluentEmojiEntry && isMissingStyleIndex)
          return resolve(dirname(importer), 'style.js');

        return null;
      },
    },
  ],
  test: {
    alias: {
      '@/database/_deprecated': resolve(__dirname, './src/database/_deprecated'),
      '@/database': resolve(__dirname, './packages/database/src'),
      '@/utils/client/switchLang': resolve(__dirname, './src/utils/client/switchLang'),
      '@/const/locale': resolve(__dirname, './src/const/locale'),
      // TODO: after refactor the errorResponse, we can remove it
      '@/utils/errorResponse': resolve(__dirname, './src/utils/errorResponse'),
      '@/utils/unzipFile': resolve(__dirname, './src/utils/unzipFile'),
      '@/utils/server': resolve(__dirname, './src/utils/server'),
      '@/utils/identifier': resolve(__dirname, './src/utils/identifier'),
      '@/utils/electron': resolve(__dirname, './src/utils/electron'),
      '@/utils/markdownToTxt': resolve(__dirname, './src/utils/markdownToTxt'),
      '@/utils': resolve(__dirname, './packages/utils/src'),
      '@/types': resolve(__dirname, './packages/types/src'),
      '@/const': resolve(__dirname, './packages/const/src'),
      '@': resolve(__dirname, './src'),
      '~test-utils': resolve(__dirname, './tests/utils.tsx'),
      'lru_map': resolve(__dirname, './tests/mocks/lru_map'),
      /* eslint-enable */
    },
    coverage: {
      all: false,
      exclude: [
        // https://github.com/lobehub/lobe-chat/pull/7265
        ...coverageConfigDefaults.exclude,
        '__mocks__/**',
        '**/packages/**',
        // just ignore the migration code
        // we will use pglite in the future
        // so the coverage of this file is not important
        'src/database/client/core/db.ts',
        'src/utils/fetch/fetchEventSource/*.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
      reportsDirectory: './coverage/app',
    },
    environment: 'happy-dom',
    exclude: [
      '**/node_modules/**',
      '**/.*/**',
      '**/dist/**',
      '**/build/**',
      '**/tmp/**',
      '**/temp/**',
      '**/docs/**',
      '**/locales/**',
      '**/public/**',
      '**/apps/desktop/**',
      '**/apps/mobile/**',
      '**/packages/**',
      '**/e2e/**',
    ],
    globals: true,
    server: {
      deps: {
        inline: [
          'vitest-canvas-mock',
          '@lobehub/ui',
          '@lobehub/fluent-emoji',
          '@pierre/diffs',
          '@pierre/diffs/react',
          'lru_map',
        ],
      },
    },
    setupFiles: join(__dirname, './tests/setup.ts'),
  },
});

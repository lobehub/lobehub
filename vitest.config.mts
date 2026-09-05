import { dirname, join, resolve } from 'node:path';

import tsconfigPaths from 'vite-tsconfig-paths';
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

if (process.env.NODE_ENV === 'production') {
  Reflect.set(process.env, 'NODE_ENV', 'test');
}

const alias = {
  // Downstream workspaces sometimes pnpm-override @lobechat/business-* packages to
  // internal implementations whose source files import alias paths that only exist
  // in the outer workspace, causing vite import-analysis to fail when running tests
  // from this repo. Pin the package to the local stub so tests here stay hermetic.
  '@lobechat/business-model-runtime': resolve(
    __dirname,
    './packages/business/model-runtime/src/index.ts',
  ),
  '@lobechat/business-model-bank/model-config': resolve(
    __dirname,
    './packages/business/model-bank/src/model-config.ts',
  ),
  '@lobechat/business-model-bank': resolve(
    __dirname,
    './packages/business/model-bank/src/index.ts',
  ),
  '@emoji-mart/data': resolve(__dirname, './tests/mocks/emojiMartData.ts'),
  '@emoji-mart/react': resolve(__dirname, './tests/mocks/emojiMartReact.tsx'),
  '@/utils/client/switchLang': resolve(__dirname, './src/utils/client/switchLang'),
  '@/const/locale': resolve(__dirname, './src/const/locale'),
  // TODO: after refactor the errorResponse, we can remove it
  '@/utils/errorResponse': resolve(__dirname, './src/utils/errorResponse'),
  '@/utils/unzipFile': resolve(__dirname, './src/utils/unzipFile'),
  '@/utils/server': resolve(__dirname, './src/utils/server'),
  // apps/auth sits outside the root tsconfig's include, so its files get no path
  // mapping from tsconfigPaths — pin the one server util its worker shares.
  '@/server/utils/serializeForHtml': resolve(__dirname, './apps/server/src/utils/serializeForHtml'),
  '@/utils/identifier': resolve(__dirname, './src/utils/identifier'),
  '@/utils/electron': resolve(__dirname, './src/utils/electron'),
  '@/utils/markdownToTxt': resolve(__dirname, './src/utils/markdownToTxt'),
  '@/utils/sanitizeFileName': resolve(__dirname, './src/utils/sanitizeFileName'),
  // Workspace store lives in the cloud repo; submodule-only tests get a stub
  // that reports no active workspace so workspace-aware nav helpers behave
  // like plain react-router.
  '@/store/workspace': resolve(__dirname, './tests/mocks/storeWorkspace.ts'),
  '~base-ui-stubs': resolve(__dirname, './tests/mocks/baseUiStubs.tsx'),
  '~test-utils': resolve(__dirname, './tests/utils.tsx'),
  'lru_map': resolve(__dirname, './tests/mocks/lru_map'),
};

export default defineConfig({
  define: {
    __CI__: process.env.CI === 'true' ? 'true' : 'false',
    __DEV__: process.env.NODE_ENV !== 'production' ? 'true' : 'false',
    __ELECTRON__: 'false',
    __MOBILE__: 'false',
    __TEST__: 'true',
  },
  optimizeDeps: {
    exclude: ['crypto', 'util', 'tty'],
    include: ['@lobehub/tts'],
  },
  plugins: [
    tsconfigPaths({ projects: ['.'] }),
    // Let `.md` imports resolve to their raw text content so Rollup/Vitest
    // doesn't try to parse Markdown as JavaScript.
    {
      name: 'raw-md',
      transform(_, id) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
    /**
     * @lobehub/fluent-emoji@4.0.0 ships `es/FluentEmoji/style.js` but its `es/FluentEmoji/index.js`
     * imports `./style/index.js` which doesn't exist.
     *
     * In app bundlers this can be tolerated/rewritten, but Vite/Vitest resolves it strictly and
     * fails the whole test run. Redirect it to the real file.
     */
    /**
     * base-ui components resolve their motion implementation through
     * `@lobehub/ui`'s internal MotionProvider module via relative imports, and
     * its hook throws without the app-level ConfigProvider. Redirect that one
     * module to a static stub so real base-ui components render in tests
     * without per-file mocks. The module has no package subpath export, so an
     * alias/vi.mock on a specifier cannot intercept it — only resolveId can.
     */
    {
      enforce: 'pre',
      name: 'stub-lobehub-ui-motion-provider',
      resolveId(id, importer) {
        if (!importer || !importer.includes('/@lobehub/ui/')) return null;
        if (id.endsWith('/MotionProvider/index.mjs') || id.endsWith('/MotionProvider/index.js'))
          return resolve(__dirname, './tests/mocks/lobehubUiMotionProvider.tsx');
        return null;
      },
    },
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
  resolve: {
    alias,
  },
  test: {
    alias,
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
        'src/utils/fetch/fetchEventSource/*.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
      reportsDirectory: './coverage/app',
    },
    environment: 'happy-dom',
    // Frontend (src/**) needs a DOM, but apps/server is backend code that runs
    // under Node in production. Forcing Node here makes `typeof window` undefined
    // so the t3-env server/client guard reads server config instead of throwing
    // "server-side environment variable on the client" — the failure the full
    // `Test Server` run hit non-deterministically (it depended on which
    // ModelRuntime-importing suite a happy-dom worker evaluated first). Per-file
    // `// @vitest-environment` directives still win over this.
    environmentMatchGlobs: [['**/apps/server/**', 'node']],
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
      '**/apps/cli/**',
      '**/packages/**',
      '**/e2e/**',
    ],
    /**
     * `@lobehub/ui` is inlined below, so without prebundling every test file
     * re-transforms and re-evaluates its whole ESM graph (~5s collect per file,
     * the bulk of the suite's runtime). Prebundling it once via esbuild lets all
     * workers share the cached chunk. The resolveId hacks from `plugins` are
     * mirrored as esbuild plugins because dep optimization bypasses vite plugins.
     */
    deps: {
      optimizer: {
        web: {
          enabled: true,
          esbuildOptions: {
            // CJS deps bundled into the chunk (antd-style) `require('react/jsx-runtime')`;
            // esbuild's ESM __require shim only works if a real `require` is in scope
            banner: {
              js: 'import { createRequire as __vitestCreateRequire } from "node:module"; const require = __vitestCreateRequire(import.meta.url);',
            },
            jsx: 'automatic',
            plugins: [
              {
                name: 'stub-lobehub-ui-motion-provider-esbuild',
                setup(build: {
                  onResolve: (
                    options: { filter: RegExp },
                    callback: (args: { importer: string }) => { path: string } | null,
                  ) => void;
                }) {
                  build.onResolve({ filter: /MotionProvider\/index\.m?js$/ }, (args) => {
                    if (!args.importer.includes('/@lobehub/ui/')) return null;
                    return {
                      path: resolve(__dirname, './tests/mocks/lobehubUiMotionProvider.tsx'),
                    };
                  });
                  build.onResolve({ filter: /^\.\/style\/index\.js$/ }, (args) => {
                    if (!args.importer.endsWith('/FluentEmoji/index.js')) return null;
                    return { path: resolve(dirname(args.importer), 'style.js') };
                  });
                },
              },
            ],
          },
          // Setting `exclude` here replaces the root optimizeDeps.exclude; the node
          // builtins must stay listed or vite swaps them for browser shims
          exclude: ['crypto', 'util', 'tty'],
          // Every imported subpath must be prebundled together: a subpath left to
          // vite-node loads a second copy of the library whose MotionProvider /
          // modal-stack contexts don't match the chunk's
          include: [
            '@lobehub/ui',
            '@lobehub/ui/base-ui',
            '@lobehub/ui/icons',
            '@lobehub/ui/mobile',
            '@lobehub/ui/chat',
            '@lobehub/ui/awesome',
            '@lobehub/ui/brand',
            '@lobehub/ui/mdx',
            '@lobehub/fluent-emoji',
            'motion',
            'motion/react',
          ],
        },
      },
    },
    globals: true,
    server: {
      deps: {
        inline: [
          'vitest-canvas-mock',
          /@emoji-mart/,
          'emoji-mart',
          '@lobehub/ui',
          '@lobehub/fluent-emoji',
          '@pierre/diffs',
          '@pierre/diffs/react',
          'lru_map',
          'lexical',
          /@lexical\//,
          /@lobehub\//,
        ],
      },
    },
    setupFiles: join(__dirname, './tests/setup.ts'),
  },
});

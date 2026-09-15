import path from 'node:path';

import { defineConfig } from 'vitest/config';

const emojiMartDataMock = path.resolve(__dirname, '../../tests/mocks/emojiMartData.mjs');
const emojiMartReactMock = path.resolve(__dirname, '../../tests/mocks/emojiMartReact.mjs');

export default defineConfig({
  resolve: {
    alias: {
      // @lobehub/editor pulls @lobehub/ui's EmojiPicker into its public
      // entrypoint. The real @emoji-mart/data package imports large JSON files
      // without Node's required import attribute; EditorRuntime tests never
      // render the picker, so use the repository's existing test-only mocks.
      '@emoji-mart/data': emojiMartDataMock,
      '@emoji-mart/react': emojiMartReactMock,
    },
  },
  test: {
    alias: {
      '@emoji-mart/data': emojiMartDataMock,
      '@emoji-mart/react': emojiMartReactMock,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
    globals: true,
    server: {
      deps: {
        // Inline @lobehub packages (and their @emoji-mart JSON imports) so Vite
        // transforms them instead of letting Node load raw JSON without an
        // import attribute.
        inline: [/@emoji-mart/, /@lobehub\//],
      },
    },
  },
});

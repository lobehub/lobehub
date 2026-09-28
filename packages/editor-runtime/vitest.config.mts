import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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

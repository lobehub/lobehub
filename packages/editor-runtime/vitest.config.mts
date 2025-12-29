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
        // Inline @emoji-mart packages to avoid ESM JSON import issues
        inline: [/@emoji-mart/, /@lobehub\/ui/],
      },
    },
  },
});

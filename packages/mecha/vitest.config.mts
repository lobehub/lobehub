import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'raw-md',
      // Builtin tool packages import their README / docs as text; the rules
      // here never read them, so resolve them to an empty module.
      transform(_, id) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
  ],
  test: {
    coverage: {
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
  },
});

import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Skill content is authored as real `.md` files and imported as strings. The app
 * bundlers already do this; vitest needs its own loader before a test can import
 * a skill module (rather than only reading its files off disk).
 */
const rawMarkdown = (): Plugin => ({
  name: 'builtin-skills-raw-markdown',
  transform(code, id) {
    if (!id.endsWith('.md')) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
});

export default defineConfig({
  plugins: [rawMarkdown()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'node',
  },
});

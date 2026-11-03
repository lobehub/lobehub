import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'raw-md',
      transform(_, id) {
        if (id.endsWith('.md')) return { code: 'export default ""', map: null };
      },
    },
  ],
  test: {
    coverage: {
      exclude: [
        // Default excludes
        'coverage/**',
        'dist/**',
        '**/node_modules/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        '**/.{git,cache,output,temp}/**',
        // Custom excludes
        '**/examples/**', // Example files
        '**/index.ts', // Export-only files
        '**/types/**', // Type definition files
      ],
      reporter: ['text', 'json', 'lcov', 'text-summary'],
    },
    environment: 'happy-dom',
  },
});



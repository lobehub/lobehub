import { fileURLToPath } from 'node:url';

import { eslint } from '@lobehub/lint';
import { flat as mdxFlat } from 'eslint-plugin-mdx';

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url));

export default eslint(
  {
    ignores: [
      // dependencies
      'node_modules',
      // ci
      'coverage',
      '.coverage',
      // test
      'jest*',
      '*.test.ts',
      '*.test.tsx',
      // umi
      '.umi',
      '.umi-production',
      '.umi-test',
      '.dumi/tmp*',
      // production
      'dist',
      'es',
      'lib',
      'logs',
      // misc
      '.next',
      // temporary directories
      'tmp',
      'temp',
      '.temp',
      '.local',
      'docs/.local',
      // cache directories
      '.cache',
      // AI coding tools directories
      '.claude',
      '.serena',
    ],
    next: true,
    react: 'next',
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir,
      },
    },
  },
  // Global rule overrides
  {
    rules: {
      '@next/next/no-img-element': 0,
      '@typescript-eslint/no-use-before-define': 0,
      '@typescript-eslint/no-useless-constructor': 0,
      'no-extra-boolean-cast': 0,
      'react/no-unknown-property': 0,
      'regexp/match-any': 0,
      'unicorn/better-regex': 0,
      '@typescript-eslint/consistent-type-imports': [
        2,
        {
          fixStyle: 'separate-type-imports',
        },
      ],
    },
  },
  // MDX files
  {
    ...mdxFlat,
    files: ['**/*.mdx'],
    rules: {
      ...mdxFlat.rules,
      '@typescript-eslint/no-unused-vars': 1,
      'no-undef': 0,
      'react/jsx-no-undef': 0,
      'react/no-unescaped-entities': 0,
    },
  },
  // Store/image and types/generation - disable sorting
  {
    files: ['src/store/image/**/*', 'src/types/generation/**/*'],
    rules: {
      'perfectionist/sort-interfaces': 0,
      'perfectionist/sort-object-types': 0,
      'perfectionist/sort-objects': 0,
    },
  },
  // CLI scripts
  {
    files: ['scripts/**/*'],
    rules: {
      'unicorn/no-process-exit': 0,
      'unicorn/prefer-top-level-await': 0,
    },
  },
  // E2E and test files - allow console.log for debugging
  {
    files: ['e2e/**/*', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-console': 0,
    },
  },
);

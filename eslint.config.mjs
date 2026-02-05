import { eslint } from '@lobehub/lint';
import { flat as mdxFlat } from 'eslint-plugin-mdx';

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
  // Global rule overrides
  {
    rules: {
      '@next/next/no-img-element': 0,
      '@typescript-eslint/no-use-before-define': 0,
      '@typescript-eslint/no-useless-constructor': 0,
      'no-extra-boolean-cast': 0,
      'react/no-unknown-property': 0,
      'unicorn/catch-error-name': 0,
      'unicorn/explicit-length-check': 0,
      'unicorn/no-array-callback-reference': 0,
      'unicorn/require-module-specifiers': 0,
      'unicorn/no-array-for-each': 0,
      'unicorn/no-negated-condition': 0,
      'unicorn/no-null': 0,
      'unicorn/no-typeof-undefined': 0,
      'unicorn/no-useless-undefined': 0,
      'unicorn/prefer-code-point': 0,
      'unicorn/prefer-logical-operator-over-ternary': 0,
      'unicorn/prefer-number-properties': 0,
      'unicorn/prefer-query-selector': 0,
      'unicorn/prefer-spread': 0,
      'unicorn/prefer-ternary': 0,
      'unicorn/prefer-type-error': 0,
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
);

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
      '@eslint-react/hooks-extra/no-direct-set-state-in-use-effect': 0,
      '@eslint-react/jsx-key-before-spread': 0,
      '@eslint-react/naming-convention/ref-name': 0,
      '@eslint-react/naming-convention/use-state': 0,
      '@eslint-react/no-array-index-key': 0,
      '@next/next/no-img-element': 0,
      '@typescript-eslint/no-use-before-define': 0,
      '@typescript-eslint/no-useless-constructor': 0,
      'no-extra-boolean-cast': 0,
      'no-restricted-syntax': 0,
      'react-refresh/only-export-components': 0,
      'react/no-unknown-property': 0,
      'regexp/match-any': 0,
      'unicorn/better-regex': 0,
    },
  },
  // TypeScript files - enforce consistent type imports
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
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
      '@typescript-eslint/consistent-type-imports': 0,
      '@typescript-eslint/no-unused-vars': 1,
      'mdx/remark': 0,
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
  // model-bank aiModels - enforce English-only descriptions
  {
    files: ['packages/model-bank/src/aiModels/**/*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          message: 'Chinese characters are not allowed in aiModels files. Use English instead.',
          selector: 'Literal[value=/[\\u4e00-\\u9fff]/]',
        },
      ],
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

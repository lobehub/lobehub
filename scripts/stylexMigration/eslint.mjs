import { readFileSync } from 'node:fs';

import stylex from '@stylexjs/eslint-plugin';
import { builtinRules } from 'eslint/use-at-your-own-risk';

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

const legacyImports = readJson('./legacyImports.json');
// `ignores` entries are globs: route segments like `[benchmarkId]` and `(main)`
// would otherwise be read as character classes and groups.
const legacyFiles = readJson('./legacyFiles.json').map((file) =>
  file.replaceAll(/[!()*+?@[\]{}]/g, String.raw`\$&`),
);

/**
 * StyleX migration guard. New code may not import the emotion-backed style APIs
 * from @lobehub/ui; files that still do are listed in legacyFiles.json, which only
 * shrinks (`bun run stylex:migration --prune-legacy`).
 *
 * The core no-restricted-imports rule is re-registered under its own name because
 * flat config replaces a rule per file: the src/** blocks already configure
 * no-restricted-imports and would otherwise override this one, or be overridden.
 */
export const stylexMigrationConfig = [
  {
    files: ['**/*.{ts,tsx}'],
    // Tests mock @lobehub/ui, including its style factories; the guard is about
    // shipped code.
    ignores: [...legacyFiles, '**/*.test.{ts,tsx}', '**/__tests__/**'],
    plugins: {
      'stylex-migration': {
        rules: { 'no-emotion-styles': builtinRules.get('no-restricted-imports') },
      },
    },
    rules: {
      'stylex-migration/no-emotion-styles': [
        'error',
        {
          paths: [
            {
              allowTypeImports: true,
              importNames: legacyImports,
              message:
                'Emotion styles are being migrated to StyleX. Use stylex.create with @lobehub/ui/stylex/cssVar.stylex (see the react skill).',
              name: '@lobehub/ui',
            },
          ],
        },
      ],
    },
  },
  {
    // sort-keys is left to perfectionist/sort-objects, which already orders keys.
    files: ['**/*.{ts,tsx}'],
    plugins: { '@stylexjs': stylex },
    rules: {
      '@stylexjs/enforce-extension': 'error',
      '@stylexjs/no-conflicting-props': 'error',
      '@stylexjs/no-legacy-contextual-styles': 'error',
      '@stylexjs/no-lookahead-selectors': 'error',
      '@stylexjs/no-unused': 'error',
      '@stylexjs/valid-shorthands': 'error',
      '@stylexjs/valid-styles': 'error',
    },
  },
];

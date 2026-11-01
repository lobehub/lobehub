import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

const legacyImports = readJson('./legacyImports.json');
// `excludeFiles` entries are globs: route segments like `[benchmarkId]` and `(main)`
// would otherwise be read as character classes and groups.
const legacyFiles = readJson('./legacyFiles.json').map((file) =>
  file.replaceAll(/[!()*+?@[\]{}]/g, String.raw`\$&`),
);

/**
 * StyleX migration guard. New code may not import the emotion-backed style APIs
 * from @lobehub/ui; files that still do are listed in legacyFiles.json, which only
 * shrinks (`bun run stylex:migration --prune-legacy`).
 */
export const stylexMigrationOverrides = [
  {
    files: ['**/*.{ts,tsx}'],
    // Tests mock @lobehub/ui, including its style factories; the guard is about
    // shipped code.
    excludeFiles: [...legacyFiles, '**/*.test.{ts,tsx}', '**/__tests__/**'],
    jsPlugins: [
      {
        name: 'stylex-migration',
        specifier: fileURLToPath(new URL('./oxlintPlugin.mjs', import.meta.url)),
      },
    ],
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
    // The other StyleX rules come from the preset's `stylex` option; sort-keys is
    // left to perfectionist/sort-objects, which already orders keys.
    files: ['**/*.{ts,tsx}'],
    jsPlugins: ['stylex'],
    rules: {
      '@stylexjs/enforce-extension': 'error',
    },
  },
];

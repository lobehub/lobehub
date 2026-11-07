import { describe, expect, it } from 'vitest';

import type { ImporterSearch, PathAliases } from './importers';
import {
  extractSpecifiers,
  findImportingTests,
  importerGrepPattern,
  MAX_IMPORTING_TESTS,
  parseJsonc,
  pathAliasesFrom,
  resolveSpecifier,
  specifierTail,
} from './importers';

/** In-memory repo: `git grep` is the same ERE pattern applied to each file's text. */
const searchOver = (sources: Record<string, string>, aliases: PathAliases[]): ImporterSearch => ({
  aliases,
  files: new Set(Object.keys(sources)),
  grep: async (tails, dots) => {
    const pattern = new RegExp(importerGrepPattern(tails, dots));
    return Object.keys(sources).filter((file) => pattern.test(sources[file]));
  },
  read: async (file) => sources[file],
});

/** A host repo mounting `sub/`; the host's `@/*` prefers its own files over the mount's. */
const hostAliases: PathAliases = {
  dir: '',
  paths: {
    '@/*': ['src/*', 'sub/src/*'],
    '@/server/*': ['src/server/*', 'apps/server/src/*', 'sub/apps/server/src/*'],
  },
};
const subAliases: PathAliases = {
  dir: 'sub',
  paths: { '@/*': ['sub/src/*'], '@/server/*': ['sub/apps/server/src/*'] },
};

describe('extractSpecifiers', () => {
  it('reads imports, re-exports, dynamic imports, require and vi.mock', () => {
    const source = [
      "import { a } from '@/a';",
      "import type { B } from './b';",
      "export * from '../c';",
      "export { d } from './d/index';",
      "import './side-effect';",
      "const e = await import('@/e');",
      "const f = require('./f');",
      "vi.mock('@/g', () => ({}));",
      "const h = await vi.importActual<typeof import('@/h')>('@/h');",
      "import {\n  i,\n} from '@/i';",
    ].join('\n');

    expect(extractSpecifiers(source)).toEqual([
      '@/a',
      './b',
      '../c',
      './d/index',
      './side-effect',
      '@/e',
      './f',
      '@/g',
      '@/h',
      '@/i',
    ]);
  });
});

describe('specifierTail', () => {
  it('names a file by its basename and an index file by its directory', () => {
    expect(specifierTail('src/a/provider.ts')).toBe('provider');
    expect(specifierTail('src/a/index.ts')).toBe('a');
  });
});

describe('resolveSpecifier', () => {
  const files = new Set([
    'src/foo.ts',
    'sub/src/foo.ts',
    'sub/src/bar.ts',
    'apps/server/src/svc/index.ts',
    'src/x/y.tsx',
  ]);

  it('resolves relative specifiers with extensions and index files', () => {
    expect(resolveSpecifier('./y', 'src/x/z.ts', [], files)).toEqual(['src/x/y.tsx']);
    expect(resolveSpecifier('../../apps/server/src/svc', 'src/x/z.ts', [], files)).toEqual([
      'apps/server/src/svc/index.ts',
    ]);
    expect(resolveSpecifier('./missing', 'src/x/z.ts', [], files)).toEqual([]);
  });

  it('takes the first existing target of the longest matching alias', () => {
    expect(resolveSpecifier('@/foo', 'src/a.ts', [hostAliases], files)).toEqual(['src/foo.ts']);
    expect(resolveSpecifier('@/bar', 'src/a.ts', [hostAliases], files)).toEqual(['sub/src/bar.ts']);
    expect(resolveSpecifier('@/server/svc', 'src/a.ts', [hostAliases], files)).toEqual([
      'apps/server/src/svc/index.ts',
    ]);
  });

  it('applies only the tables covering the importer', () => {
    expect(resolveSpecifier('@/foo', 'src/a.ts', [hostAliases, subAliases], files)).toEqual([
      'src/foo.ts',
    ]);
    expect(resolveSpecifier('@/foo', 'sub/src/a.ts', [hostAliases, subAliases], files)).toEqual([
      'src/foo.ts',
      'sub/src/foo.ts',
    ]);
  });
});

describe('findImportingTests', () => {
  it('follows a barrel and a re-export to a test with an unrelated name', async () => {
    const search = searchOver(
      {
        'apps/server/src/services/widget/provider.ts': 'export const provider = 1;',
        'apps/server/src/services/widget/index.ts': "export * from './provider';",
        'apps/server/src/services/widget/lifecycle.test.ts': "import { provider } from '.';",
        'src/business/server/widget.ts': "export { provider } from '@/server/services/widget';",
        'src/business/server/widget.test.ts': "import { provider } from './widget';",
        'src/business/server/other.test.ts': "import { other } from './other';",
      },
      [hostAliases],
    );

    expect(
      await findImportingTests(['apps/server/src/services/widget/provider.ts'], search),
    ).toEqual({
      tests: [
        'apps/server/src/services/widget/lifecycle.test.ts',
        'src/business/server/widget.test.ts',
      ],
      truncated: false,
    });
  });

  describe('a host file overriding a mounted file at the same path', () => {
    const search = searchOver(
      {
        'src/foo.ts': 'export const foo = 1;',
        'sub/src/foo.ts': 'export const foo = 0;',
        'sub/src/feature.ts': "export { foo } from '@/foo';",
        // A host test reaching the override directly and through a mounted module.
        'src/foo.test.ts': "import { foo } from '@/foo';",
        'src/feature.host.test.ts': "import { foo } from '@/feature';",
        // The mounted repo's own test runs under its own aliases.
        'sub/src/feature.test.ts': "import { foo } from './feature';",
      },
      [hostAliases, subAliases],
    );

    it('runs host tests when the host override changes', async () => {
      expect((await findImportingTests(['src/foo.ts'], search)).tests).toEqual([
        'src/foo.test.ts',
        'src/feature.host.test.ts',
      ]);
    });

    it('skips host tests importing the override when the mounted file changes', async () => {
      // A host test reaching a mounted module still counts: which file that module's `@/foo`
      // resolves to there depends on the runner, so the lookup keeps it rather than miss it.
      expect((await findImportingTests(['sub/src/foo.ts'], search)).tests).toEqual([
        'src/feature.host.test.ts',
        'sub/src/feature.test.ts',
      ]);
    });
  });

  it('runs a host test that imports a mounted module through an alias', async () => {
    const search = searchOver(
      {
        'sub/src/utils/format.ts': 'export const format = 1;',
        'src/features/page.ts': "import { format } from '@/utils/format';",
        'src/features/page.test.ts': "import './page';",
      },
      [hostAliases, subAliases],
    );

    expect((await findImportingTests(['sub/src/utils/format.ts'], search)).tests).toEqual([
      'src/features/page.test.ts',
    ]);
  });

  it('finds a test importing the file through an exact alias with another name', async () => {
    const search = searchOver(
      {
        'tests/utils.tsx': '',
        'src/services/plugin.test.ts': "import { render } from '~test-utils';",
      },
      [{ dir: '', paths: { '~test-utils': ['tests/utils.tsx'] } }],
    );

    expect((await findImportingTests(['tests/utils.tsx'], search)).tests).toEqual([
      'src/services/plugin.test.ts',
    ]);
  });

  it('finds a test importing an index file as ./index', async () => {
    const search = searchOver(
      { 'src/scan/index.ts': '', 'src/scan/patch.test.ts': "import { scan } from './index';" },
      [hostAliases],
    );

    expect((await findImportingTests(['src/scan/index.ts'], search)).tests).toEqual([
      'src/scan/patch.test.ts',
    ]);
  });

  it('stops at three hops', async () => {
    const search = searchOver(
      {
        'src/a.ts': '',
        'src/b.ts': "import './a';",
        'src/c.ts': "import './b';",
        'src/d.ts': "import './c';",
        'src/d.test.ts': "import './d';",
        'src/c.test.ts': "import './c';",
      },
      [hostAliases],
    );

    expect((await findImportingTests(['src/a.ts'], search)).tests).toEqual(['src/c.test.ts']);
  });

  it('caps a widely imported module and reports the truncation', async () => {
    const sources: Record<string, string> = { 'src/shared.ts': '' };
    for (let index = 0; index <= MAX_IMPORTING_TESTS; index++) {
      sources[`src/t${index}.test.ts`] = "import './shared';";
    }

    const result = await findImportingTests(['src/shared.ts'], searchOver(sources, [hostAliases]));
    expect(result.tests).toHaveLength(MAX_IMPORTING_TESTS);
    expect(result.truncated).toBe(true);
  });

  it('ignores changed tests and non-source files', async () => {
    const search = searchOver({ 'src/a.test.ts': '', 'src/b.test.ts': "import './a.test';" }, [
      hostAliases,
    ]);

    expect(await findImportingTests(['src/a.test.ts', 'README.md'], search)).toEqual({
      tests: [],
      truncated: false,
    });
  });
});

describe('importerGrepPattern', () => {
  it('matches a tail at a specifier end and escapes regex characters', () => {
    const pattern = new RegExp(importerGrepPattern(['provider', '[id]'], false));
    expect(pattern.test("from './provider'")).toBe(true);
    expect(pattern.test("from '@/x/provider/index.ts'")).toBe(true);
    expect(pattern.test("from './[id]'")).toBe(true);
    expect(pattern.test("from './providers'")).toBe(false);
    expect(pattern.test("from '.'")).toBe(false);
  });

  it('adds bare `.` and `..` specifiers for index files', () => {
    const pattern = new RegExp(importerGrepPattern(['svc'], true));
    expect(pattern.test("from '.'")).toBe(true);
    expect(pattern.test("from '../'")).toBe(true);
    expect(pattern.test("from './index'")).toBe(true);
    expect(pattern.test("from '../../index.ts'")).toBe(true);
    expect(pattern.test("from './other'")).toBe(false);
  });
});

describe('tsconfig paths', () => {
  it('parses comments and trailing commas without touching strings', () => {
    const text = `{
      // line comment
      "compilerOptions": {
        /* block */
        "paths": { "@/*": ["./src/*",], "a//b": ["./c/*"] },
      },
    }`;

    expect(pathAliasesFrom('sub', parseJsonc(text))).toEqual({
      dir: 'sub',
      paths: { '@/*': ['sub/src/*'], 'a//b': ['sub/c/*'] },
    });
  });

  it('returns null without paths', () => {
    expect(pathAliasesFrom('', parseJsonc('{ "compilerOptions": {} }'))).toBeNull();
  });
});

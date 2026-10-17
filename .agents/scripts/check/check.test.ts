import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findNewComponentTestAdvisories } from './advisories';
import { alintScopeArgs, keepSelectedFiles, parseAlintJson } from './alint';
import { diffStat, renderDiffsForStdout } from './autofix';
import { parseRenames } from './base';
import { checkFileSizes, countLines } from './fileSize';
import { lobehubPipelines } from './pipelines';
import {
  findVitestConfigDir,
  isTestFile,
  pipelineFor,
  relatedTestCandidates,
  resolveMount,
  scenarioTestLookup,
  stylelintApplies,
} from './routing';
import type { RepoMount } from './types';
import { compactVitestOutput } from './vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('resolveMount', () => {
  const root: RepoMount = { dir: '', pipelines: lobehubPipelines };
  const sub: RepoMount = { dir: 'vendor/sub', pipelines: [] };
  const repos = [root, sub];

  it('routes mount-prefixed paths to the mount with a mount-relative subPath', () => {
    expect(resolveMount(repos, 'vendor/sub/src/utils/uuid.ts')).toEqual({
      mount: sub,
      subPath: 'src/utils/uuid.ts',
    });
  });

  it('routes everything else to the root mount', () => {
    expect(resolveMount(repos, 'src/auth.ts')).toEqual({ mount: root, subPath: 'src/auth.ts' });
    // A root path that merely starts with the same letters is not the mount
    expect(resolveMount(repos, 'vendor/sub-tools/a.ts').mount).toBe(root);
  });

  it('prefers the longest matching mount dir', () => {
    const nested: RepoMount = { dir: 'vendor/sub/nested', pipelines: [] };
    expect(resolveMount([root, sub, nested], 'vendor/sub/nested/a.ts').mount).toBe(nested);
  });
});

describe('pipelineFor', () => {
  it('maps ts/tsx to the stylelint+eslint+prettier pipeline', () => {
    const pipeline = pipelineFor(lobehubPipelines, 'src/auth.ts');
    expect(pipeline?.tools.map(([tool]) => tool)).toEqual(['stylelint', 'eslint', 'prettier']);
  });

  it('maps md to remark+prettier and json to prettier only', () => {
    expect(pipelineFor(lobehubPipelines, 'AGENTS.md')?.tools.map(([tool]) => tool)).toEqual([
      'remark',
      'prettier',
    ]);
    expect(pipelineFor(lobehubPipelines, 'package.json')?.tools.map(([tool]) => tool)).toEqual([
      'prettier',
    ]);
  });

  it('returns null for extensions with no pipeline', () => {
    expect(pipelineFor(lobehubPipelines, '.github/workflows/ci.yml')).not.toBeNull();
    expect(pipelineFor(lobehubPipelines, 'image.png')).toBeNull();
    expect(pipelineFor([], 'a.ts')).toBeNull();
  });
});

describe('lobehubPipelines drift', () => {
  /**
   * Guards the handwritten mirror in pipelines.ts against drifting from the
   * real lint-staged config in package.json. Compares tool-name sequences
   * only — flags legitimately differ (e.g. `--parser=typescript`,
   * `--no-error-on-unmatched-pattern`).
   */
  const globExts = (glob: string): string[] => {
    const match = glob.match(/^\*\.(?:\{([^}]+)\}|(\w+))$/);
    if (!match) throw new Error(`unrecognized lint-staged glob: ${glob}`);
    return (match[1]?.split(',') ?? [match[2]]).map((ext) => `.${ext}`);
  };

  it('mirrors the lint-staged config', async () => {
    const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
      'lint-staged': Record<string, string[]>;
    };
    const entries = Object.entries(pkg['lint-staged']);
    expect(entries.length).toBeGreaterThan(0);

    for (const [glob, commands] of entries) {
      const expected = commands.map((command) => command.split(' ')[0]);
      for (const ext of globExts(glob)) {
        expect(
          pipelineFor(lobehubPipelines, `sample${ext}`)?.tools.map(([tool]) => tool),
          `lint-staged "${glob}" (${ext})`,
        ).toEqual(expected);
      }
    }
  });
});

describe('stylelintApplies', () => {
  it('scopes stylelint to src/tests like the lint:style scripts', () => {
    expect(stylelintApplies('src/auth.ts')).toBe(true);
    expect(stylelintApplies('tests/foo.ts')).toBe(true);
    // stylelint's CSS-in-JS fixer corrupts files outside its configured scope
    expect(stylelintApplies('.agents/scripts/check/index.ts')).toBe(false);
    expect(stylelintApplies('packages/utils/src/a.ts')).toBe(false);
  });
});

describe('relatedTestCandidates', () => {
  it('returns the file itself when it is already a test', () => {
    expect(isTestFile('src/auth.test.ts')).toBe(true);
    expect(relatedTestCandidates('src/auth.test.ts')).toEqual(['src/auth.test.ts']);
  });

  it('lists sibling and __tests__ candidates for source files', () => {
    expect(relatedTestCandidates('src/auth.ts')).toEqual([
      'src/auth.test.ts',
      'src/__tests__/auth.test.ts',
      'src/auth.test.tsx',
      'src/__tests__/auth.test.tsx',
      'src/auth.test.mts',
      'src/__tests__/auth.test.mts',
    ]);
  });

  it('matches scenario suites split from the source test', () => {
    const lookup = scenarioTestLookup('src/Foo/index.tsx');
    expect(lookup?.dirs).toEqual(['src/Foo', 'src/Foo/__tests__']);
    expect(
      [
        'index.cta.test.ts',
        'index.render.test.tsx',
        'index.test.ts',
        'indexer.cta.test.ts',
        'index.a.b.test.ts',
      ].filter((name) => lookup?.matches(name)),
    ).toEqual(['index.cta.test.ts', 'index.render.test.tsx']);
    expect(scenarioTestLookup('src/Foo/index.test.ts')).toBeNull();
  });

  it('returns nothing for non-source files', () => {
    expect(relatedTestCandidates('AGENTS.md')).toEqual([]);
    expect(relatedTestCandidates('image.png')).toEqual([]);
  });
});

describe('findNewComponentTestAdvisories', () => {
  it('warns only for new .test.tsx files', async () => {
    const advisories = await findNewComponentTestAdvisories(
      ['src/New.test.tsx', 'src/Existing.test.tsx', 'src/useFeature.test.ts'],
      async (file) => ({
        baseRef: 'origin/canary',
        exists: file.includes('Existing'),
      }),
    );

    expect(advisories).toEqual([
      expect.stringContaining('src/New.test.tsx: new .test.tsx file relative to origin/canary'),
    ]);
    expect(advisories[0]).toContain(
      '.agents/skills/testing/SKILL.md (Core Principles: "No new component tests")',
    );
  });

  it('skips the warning when the configured base cannot be inspected', async () => {
    await expect(
      findNewComponentTestAdvisories(['src/New.test.tsx'], async () => undefined),
    ).resolves.toEqual([]);
  });
});

describe('parseRenames', () => {
  it('maps each renamed path to its source path', () => {
    expect(parseRenames('R098\0src/Foo.tsx\0src/Foo/index.tsx\0R100\0a.ts\0b/a.ts\0')).toEqual(
      new Map([
        ['src/Foo/index.tsx', 'src/Foo.tsx'],
        ['b/a.ts', 'a.ts'],
      ]),
    );
    expect(parseRenames('')).toEqual(new Map());
  });
});

describe('countLines', () => {
  it.each([
    ['', 0],
    ['a\n', 1],
    ['a\nb', 2],
    ['a\nb\n', 2],
  ])('counts %j as %i lines', (content, expected) => {
    expect(countLines(content)).toBe(expected);
  });
});

describe('checkFileSizes', () => {
  const current: Record<string, number> = {
    'src/Big.ts': 801,
    'src/Crossed.ts': 900,
    'src/Grown.tsx': 1200,
    'src/Shrunk.ts': 1000,
    'src/Small.ts': 800,
    'packages/locales/src/default/setting.ts': 5000,
    'packages/locales/src/create.ts': 900,
    'src/types.d.ts': 2000,
    'packages/sdk/src/generated/types.gen.ts': 12000,
    'packages/sdk/src/generated/core/client.ts': 900,
    'README.md': 5000,
  };
  const base: Record<string, number | null> = {
    'src/Big.ts': null,
    'packages/locales/src/create.ts': null,
    'packages/locales/src/default/setting.ts': 4000,
    'src/types.d.ts': 1000,
    'packages/sdk/src/generated/types.gen.ts': null,
    'packages/sdk/src/generated/core/client.ts': null,
    'src/Crossed.ts': 790,
    'src/Grown.tsx': 1100,
    'src/Shrunk.ts': 1100,
  };
  const run = (files: string[]) =>
    checkFileSizes(
      files,
      async (file) => current[file],
      async (file) => ({ baseRef: 'origin/canary', lines: base[file] }),
    );

  it('fails new and newly oversized files and only advises on grown legacy files', async () => {
    const findings = await run(Object.keys(current));

    expect(findings.errors).toEqual([
      expect.stringContaining('src/Big.ts: new file has 801 lines'),
      expect.stringContaining('src/Crossed.ts: grew from 790 to 900 lines'),
      expect.stringContaining('packages/locales/src/create.ts: new file has 900 lines'),
    ]);
    expect(findings.advisories).toEqual([
      expect.stringContaining('src/Grown.tsx: already over 800 lines and grew from 1100 to 1200'),
    ]);
  });

  it('skips oversized files when the base cannot be inspected', async () => {
    await expect(
      checkFileSizes(
        ['src/Big.ts'],
        async () => 801,
        async () => undefined,
      ),
    ).resolves.toEqual({ advisories: [], errors: [] });
  });
});

describe('findVitestConfigDir', () => {
  const configs = new Set([
    'vitest.config.mts',
    'vendor/sub/vitest.config.mts',
    'vendor/sub/packages/utils/vitest.config.mts',
  ]);
  const exists = async (candidate: string) => configs.has(candidate);

  it('picks the nearest config walking up from the test file', async () => {
    await expect(
      findVitestConfigDir('vendor/sub/packages/utils/src/apiKey.test.ts', exists),
    ).resolves.toBe('vendor/sub/packages/utils');
    await expect(findVitestConfigDir('vendor/sub/src/utils/uuid.test.ts', exists)).resolves.toBe(
      'vendor/sub',
    );
    await expect(findVitestConfigDir('src/auth.test.ts', exists)).resolves.toBe('.');
  });

  it('falls back to the repo root when no config is found', async () => {
    await expect(
      findVitestConfigDir('somewhere/deep/file.test.ts', async () => false),
    ).resolves.toBe('.');
  });
});

describe('diffStat', () => {
  it('counts added/removed lines, ignoring file headers', () => {
    const diff = ['--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', '-old', '+new', '+extra'].join('\n');
    expect(diffStat(diff)).toEqual({ added: 2, removed: 1 });
  });
});

describe('renderDiffsForStdout', () => {
  it('prints short diffs in full and truncates long ones to a stat line', () => {
    const shortDiff = { added: 1, diff: '--- a/f\n+++ b/f\n+new', file: 'f.ts', removed: 0 };
    const longDiff = {
      added: 30,
      diff: Array.from({ length: 40 }, (_, index) => `+line${index}`).join('\n'),
      file: 'g.ts',
      removed: 10,
    };
    const output = renderDiffsForStdout([shortDiff, longDiff], 10);
    expect(output).toContain('+new');
    expect(output).toContain('g.ts\n  (diff 40 lines > 10, truncated');
    expect(output).toContain('+30 -10');
    expect(output).not.toContain('+line5');
  });
});

describe('compactVitestOutput', () => {
  it('keeps only the failed-tests detail section without banners', () => {
    const raw = [
      ' RUN  v3.2.4 /repo',
      '',
      ' ❯ src/a.test.ts (1 test | 1 failed) 3ms',
      '   Start at  19:13:49',
      '   Duration  193ms',
      '',
      '⎯⎯⎯ Failed Tests 1 ⎯⎯⎯',
      '',
      ' FAIL  src/a.test.ts > fails',
      'AssertionError: expected 1 to be 2',
      '⎯⎯⎯⎯⎯⎯[1/1]⎯',
    ].join('\n');
    const compact = compactVitestOutput(raw);
    expect(compact).toBe('FAIL  src/a.test.ts > fails\nAssertionError: expected 1 to be 2');
  });

  it('falls back to filtering noise when no failed-tests section exists', () => {
    const raw = [' RUN  v3.2.4 /repo', 'Error: config not found', '   Duration  1ms'].join('\n');
    expect(compactVitestOutput(raw)).toBe('Error: config not found');
  });
});

describe('parseAlintJson', () => {
  it('maps alint diagnostics to root-relative lint problems', () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          evidence: { confidence: 'high' },
          filePath: '/repo/apps/server/src/services/x.ts',
          loc: { start: { column: 0, line: 12 } },
          message: 'Promise.all fans out over rows\nSuggestion: use pMap',
          ruleId: 'lobehub/pmap-over-promise-all',
          severity: 'warn',
        },
      ],
      execution: {},
      usage: {},
    });
    expect(parseAlintJson(stdout, '/repo')).toEqual([
      {
        file: 'apps/server/src/services/x.ts',
        line: 12,
        message: 'Promise.all fans out over rows',
        rule: 'lobehub/pmap-over-promise-all',
        severity: 'warning',
      },
    ]);
  });

  it('returns null when stdout is not alint JSON', () => {
    expect(parseAlintJson('alint: no .alint config', '/repo')).toBeNull();
  });
});

describe('alint scope', () => {
  const files = ['packages/database/src/models/goalGraph.ts'];
  const problem = (file: string) => ({
    file,
    line: 383,
    message: 'transaction writes two tables',
    rule: 'lobehub/no-transactions-in-models',
    severity: 'error' as const,
  });

  it('lints changed lines only for the default git scope, like CI', () => {
    expect(alintScopeArgs(files, { changedLinesOnly: true })).toEqual(['--dirty']);
  });

  it('lints explicit paths whole', () => {
    expect(alintScopeArgs(files, { changedLinesOnly: false })).toEqual(files);
  });

  it('drops dirty findings outside the selected files (e.g. --staged)', () => {
    const problems = [problem(files[0]), problem('src/unstaged.tsx')];
    expect(keepSelectedFiles(problems, files, { changedLinesOnly: true })).toEqual([
      problem(files[0]),
    ]);
    expect(keepSelectedFiles(problems, files, { changedLinesOnly: false })).toEqual(problems);
  });
});

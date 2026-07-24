import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findNewComponentTestAdvisories } from './advisories';
import { diffStat, renderDiffsForStdout } from './autofix';
import { hostRootFromGitdir } from './delegate';
import { lobehubPipelines } from './pipelines';
import {
  findVitestConfigDir,
  isTestFile,
  pipelineFor,
  relatedTestCandidates,
  resolveMount,
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

describe('hostRootFromGitdir', () => {
  it('extracts the superproject root from a submodule gitdir', () => {
    expect(hostRootFromGitdir('/work/host/.git/modules/vendor/sub')).toBe('/work/host');
  });

  it('returns null for standalone clones and linked worktrees', () => {
    expect(hostRootFromGitdir('/work/repo/.git')).toBeNull();
    expect(hostRootFromGitdir('/work/repo/.git/worktrees/feature')).toBeNull();
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

import { describe, expect, it, vi } from 'vitest';

import type { GrepContentParams, GrepContentResult } from '../../types';
import { BaseContentSearch } from '../base';

vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('fast-glob', () => ({ default: vi.fn().mockResolvedValue([]) }));

class TestContentSearch extends BaseContentSearch {
  async grep(params: GrepContentParams): Promise<GrepContentResult> {
    return this.grepWithNodejs(params);
  }

  async checkToolAvailable(): Promise<boolean> {
    return true;
  }

  public testBuildGrepArgs(
    tool: 'ag' | 'grep' | 'rg',
    params: GrepContentParams,
    target?: string,
  ): string[] {
    return this.buildGrepArgs(tool, params, target);
  }

  public testGetDefaultIgnorePatterns(): string[] {
    return this.getDefaultIgnorePatterns();
  }
}

const argsFor = (tool: 'ag' | 'grep' | 'rg') =>
  new TestContentSearch()
    .testBuildGrepArgs(tool, {
      output_mode: 'files_with_matches',
      pattern: 'com.apple.security',
    } as GrepContentParams)
    .join(' ');

/**
 * Build output must be excluded because *git* ignores it, never because its
 * directory happens to be called `dist` / `build` / `out`. Those names are only
 * usually generated — this repo tracks `apps/desktop/build/entitlements.mac.plist`
 * — and `rg`'s `--glob` overrides all ignore logic, so hardcoding them silently
 * makes checked-in files unfindable on every engine.
 */
const NEVER_HARDCODED = ['.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.cache'];

describe('unconditional search exclusions', () => {
  it.each(['rg', 'ag', 'grep'] as const)('excludes only node_modules and .git for %s', (tool) => {
    const joined = argsFor(tool);

    expect(joined).toContain('node_modules');
    expect(joined).toContain('.git');
  });

  it.each(['rg', 'ag', 'grep'] as const)(
    'does not hide directories that may be tracked (%s)',
    (tool) => {
      const joined = argsFor(tool);

      for (const dir of NEVER_HARDCODED) {
        expect(joined, `${tool} must not hardcode an exclusion for ${dir}`).not.toContain(
          `${dir}/**`,
        );
        expect(joined, `${tool} must not hardcode an exclusion for ${dir}`).not.toContain(
          `-dir ${dir}`,
        );
      }
    },
  );

  it('keeps the nodejs fallback ignore patterns just as narrow', () => {
    const patterns = new TestContentSearch().testGetDefaultIgnorePatterns();

    expect(patterns).toEqual(['**/node_modules/**', '**/.git/**']);
  });
});

describe('single-file targets', () => {
  it.each([
    ['rg', '-H'],
    ['grep', '-H'],
    ['ag', '--filename'],
  ] as const)('forces the filename prefix for %s', (tool, flag) => {
    const withFile = new TestContentSearch().testBuildGrepArgs(
      tool,
      { output_mode: 'content', pattern: 'needle' } as GrepContentParams,
      './a.ts',
    );
    const withDir = new TestContentSearch().testBuildGrepArgs(tool, {
      output_mode: 'content',
      pattern: 'needle',
    } as GrepContentParams);

    expect(withFile).toContain(flag);
    // A directory search already prefixes filenames; don't add redundant flags.
    expect(withDir).not.toContain(flag);
  });

  it('keeps the target relative so an explicitly scoped excluded dir still works', () => {
    const args = new TestContentSearch().testBuildGrepArgs(
      'rg',
      { output_mode: 'files_with_matches', pattern: 'needle' } as GrepContentParams,
      '.',
    );

    expect(args.at(-1)).toBe('.');
  });
});

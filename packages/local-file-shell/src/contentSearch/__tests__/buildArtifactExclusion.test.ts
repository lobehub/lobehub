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

  public testBuildGrepArgs(tool: 'ag' | 'grep' | 'rg', params: GrepContentParams): string[] {
    return this.buildGrepArgs(tool, params);
  }

  public testGetDefaultIgnorePatterns(): string[] {
    return this.getDefaultIgnorePatterns();
  }
}

/**
 * Regression: engine selection must not change what a search *finds*.
 *
 * `rg` and `ag` honour `.gitignore`, so build output (`.next`, `dist`, `build`,
 * coverage, …) never reaches the agent. `grep` and the Node fallback have no
 * ignore-file awareness and only exclude `node_modules` + `.git`, so the exact
 * same query returns hundreds of compiled `.next/dev/server/chunks/*.js(.map)`
 * hits on a machine where ripgrep isn't on the Electron PATH.
 */
const BUILD_ARTIFACT_DIRS = ['.next', 'dist', 'build', 'coverage', '.turbo'];

describe('content search build-artifact exclusion', () => {
  it.each(['grep', 'ag'] as const)('excludes build output for %s', (tool) => {
    const args = new TestContentSearch().testBuildGrepArgs(tool, {
      output_mode: 'files_with_matches',
      pattern: 'class KeyVaultsGateKeeper',
    } as GrepContentParams);

    const joined = args.join(' ');
    for (const dir of BUILD_ARTIFACT_DIRS) {
      expect(joined, `${tool} should exclude ${dir}`).toContain(dir);
    }
  });

  it('excludes build output in the nodejs fallback ignore patterns', () => {
    const patterns = new TestContentSearch().testGetDefaultIgnorePatterns().join(' ');

    for (const dir of BUILD_ARTIFACT_DIRS) {
      expect(patterns, `nodejs fallback should ignore ${dir}`).toContain(dir);
    }
  });
});

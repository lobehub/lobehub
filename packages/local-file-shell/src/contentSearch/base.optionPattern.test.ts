import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { grepContent } from '../file/grep';
import type { GrepContentParams } from '../types';
import { BaseContentSearch } from './base';

class Search extends BaseContentSearch {
  async checkToolAvailable() {
    return true;
  }
  async grep(params: GrepContentParams) {
    return this.grepWithNodejs(params);
  }
  args(tool: 'rg' | 'grep' | 'ag', pattern: string) {
    return this.buildGrepArgs(tool, { pattern, output_mode: 'files_with_matches' });
  }
}

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'grep-option-pattern-'));
  await writeFile(path.join(directory, 'flags.txt'), '--help\n-needle\n');
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('search patterns beginning with a dash', () => {
  for (const tool of ['rg', 'grep'] as const) {
    it.skipIf(spawnSync(tool, ['--version']).error !== undefined)(
      `${tool} searches the literal option-shaped pattern`,
      () => {
        const output = execFileSync(tool, new Search().args(tool, '--help'), {
          cwd: directory,
          encoding: 'utf8',
        });
        expect(output.trim()).toBe('./flags.txt');
      },
    );
  }

  it.skipIf(spawnSync('rg', ['--version']).error !== undefined)(
    'also protects the lightweight ripgrep entry point',
    async () => {
      const result = await grepContent({ cwd: directory, pattern: '--help' });
      expect(result.success).toBe(true);
      expect(result.matches).toEqual(['./flags.txt']);
    },
  );
});

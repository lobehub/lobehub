import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GrepContentParams } from '../types';
import { BaseContentSearch } from './base';

class Search extends BaseContentSearch {
  async checkToolAvailable() {
    return false;
  }
  async grep(params: GrepContentParams) {
    return this.grepWithNodejs(params);
  }
}

let directory: string;
let file: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'grep-line-semantics-'));
  file = path.join(directory, 'sample.txt');
  await writeFile(file, 'first line\nneedle needle\nneedle\n');
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('Node grep fallback line semantics', () => {
  it('finds anchored matches after the first line in files mode', async () => {
    const result = await new Search().grep({
      scope: file,
      pattern: '^needle',
      output_mode: 'files_with_matches',
    });
    expect(result.matches).toEqual([file]);
  });

  it('counts matching lines instead of occurrences within those lines', async () => {
    const result = await new Search().grep({
      scope: file,
      pattern: 'needle',
      output_mode: 'count',
    });
    expect(result.matches).toEqual([`${file}:2`]);
    expect(result.total_matches).toBe(2);
  });

  it('does not invent a blank line after the final newline', async () => {
    const result = await new Search().grep({ scope: file, pattern: '^$', output_mode: 'count' });
    expect(result.matches).toEqual([]);
    expect(result.total_matches).toBe(0);
  });

  it('retains explicit multiline matching across line boundaries', async () => {
    const result = await new Search().grep({
      scope: file,
      pattern: 'first line\\nneedle',
      multiline: true,
      output_mode: 'files_with_matches',
    });
    expect(result.matches).toEqual([file]);
  });
});

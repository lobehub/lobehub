import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listDir } from '../workspace';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'device-list-dir-'));
  await mkdir(path.join(root, 'alpha'));
  await mkdir(path.join(root, 'zeta'));
  await mkdir(path.join(root, '.hidden'));
  await writeFile(path.join(root, 'readme.md'), 'file');
});

afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});

describe('listDir', () => {
  it('lists immediate child directories and skips files and hidden folders', async () => {
    const result = await listDir({ path: root });

    expect(result.path).toBe(root);
    expect(result.parent).toBe(path.dirname(root));
    expect(result.dirs.map((dir) => dir.name)).toEqual(['alpha', 'zeta']);
    expect(result.dirs.map((dir) => dir.path)).toEqual([
      path.join(root, 'alpha'),
      path.join(root, 'zeta'),
    ]);
  });

  it('starts at the device home when the path is empty', async () => {
    const result = await listDir({ path: '   ' });
    expect(result.path).toBe(homedir());
  });

  it('falls back to the device home when the requested path is missing', async () => {
    const result = await listDir({ path: path.join(root, 'missing') });
    expect(result.path).toBe(homedir());
  });

  it('expands a leading ~ before listing', async () => {
    const result = await listDir({ path: '~' });
    expect(result.path).toBe(homedir());
  });
});

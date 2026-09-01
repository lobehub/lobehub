import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { statPath } from '../workspace';

let home: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'device-control-stat-path-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  await mkdir(path.join(home, 'projects', 'demo'), { recursive: true });
  await writeFile(path.join(home, 'file.txt'), 'file');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(home, { force: true, recursive: true });
});

describe('statPath', () => {
  it('expands the device home and returns the normalized absolute path', async () => {
    const result = await statPath({ path: '~/projects/../projects/demo' });

    expect(result).toMatchObject({
      exists: true,
      isDirectory: true,
      path: path.join(home, 'projects', 'demo'),
    });
  });

  it('resolves relative paths from the device home', async () => {
    const result = await statPath({ path: 'projects/demo' });

    expect(result).toMatchObject({
      exists: true,
      isDirectory: true,
      path: path.join(home, 'projects', 'demo'),
    });
  });

  it('returns the normalized path for a missing tilde path', async () => {
    const result = await statPath({ path: '~/missing' });

    expect(result).toEqual({
      exists: false,
      isDirectory: false,
      path: path.join(home, 'missing'),
    });
  });

  it('distinguishes files from directories', async () => {
    const result = await statPath({ path: '~/file.txt' });

    expect(result).toEqual({
      exists: true,
      isDirectory: false,
      path: path.join(home, 'file.txt'),
    });
  });
});

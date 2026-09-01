import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { listDir } from '../workspace';

let home: string;
let root: string;

beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'device-control-home-'));
  root = await mkdtemp(path.join(tmpdir(), 'device-control-list-dir-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await Promise.all([home, root].map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('listDir', () => {
  it('returns hidden entries, files, and directory symlinks with directories first', async () => {
    const targetDir = path.join(root, 'z-directory');
    await Promise.all([
      mkdir(path.join(root, '.hidden-directory')),
      mkdir(targetDir),
      writeFile(path.join(root, 'a-file.txt'), 'file'),
    ]);
    await symlink(
      targetDir,
      path.join(root, 'linked-directory'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await symlink(
      path.join(root, 'missing-target'),
      path.join(root, 'broken-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const result = await listDir({ path: root });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.entries.map((entry) => entry.type)).toEqual([
      'directory',
      'directory',
      'directory',
      'file',
    ]);
    expect(result.entries.find((entry) => entry.name === '.hidden-directory')).toMatchObject({
      hidden: true,
      type: 'directory',
    });
    expect(result.entries.find((entry) => entry.name === 'linked-directory')).toMatchObject({
      isSymlink: true,
      type: 'directory',
    });
    expect(result.entries.some((entry) => entry.name === 'broken-link')).toBe(false);
  });

  it('starts at the device home for a blank path', async () => {
    const result = await listDir();

    expect(result).toMatchObject({ home, path: home, success: true });
  });

  it('expands a leading tilde on the device', async () => {
    const nested = path.join(home, 'nested');
    await mkdir(nested);

    const result = await listDir({ path: '~/nested' });

    expect(result).toMatchObject({ path: nested, success: true });
  });

  it('returns NOT_FOUND without falling back to home', async () => {
    const missing = path.join(root, 'missing');

    const result = await listDir({ path: missing });

    expect(result).toMatchObject({ code: 'NOT_FOUND', path: missing, success: false });
  });

  it('returns NOT_DIRECTORY for a file path', async () => {
    const file = path.join(root, 'not-a-directory.txt');
    await writeFile(file, 'file');

    const result = await listDir({ path: file });

    expect(result).toMatchObject({ code: 'NOT_DIRECTORY', path: file, success: false });
  });

  it('does not expose a parent above the filesystem root', async () => {
    const filesystemRoot = path.parse(home).root;

    const result = await listDir({ path: filesystemRoot });

    expect(result.success).toBe(true);
    if (result.success) expect(result.parent).toBeNull();
  });
});

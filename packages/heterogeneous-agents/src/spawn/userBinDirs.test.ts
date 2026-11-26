import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findCommandInUserBinDirs, getUserBinDirs, sortVersionDirsDesc } from './userBinDirs';

describe('sortVersionDirsDesc', () => {
  it('orders Node version folders newest first, numerically, and drops the rest', () => {
    expect(sortVersionDirsDesc(['v9.11.2', 'v18.20.0', 'v22.3.0', 'v22.10.1', '.cache'])).toEqual([
      'v22.10.1',
      'v22.3.0',
      'v18.20.0',
      'v9.11.2',
    ]);
  });
});

describe('getUserBinDirs on Windows', () => {
  const home = 'C:\\Users\\me';
  const env = {
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    NVM_SYMLINK: 'C:\\nvm4w\\nodejs',
    ProgramData: 'C:\\ProgramData',
    ProgramFiles: 'C:\\Program Files',
  };

  it('covers npm, pnpm, bun, Volta, nvm-windows, fnm, Scoop, winget and Chocolatey', async () => {
    const dirs = await getUserBinDirs({ env, home, os: 'win32' });

    expect(dirs).toEqual(
      expect.arrayContaining([
        'C:\\Users\\me\\.local\\bin',
        'C:\\Users\\me\\AppData\\Roaming\\npm',
        'C:\\Users\\me\\AppData\\Local\\pnpm',
        'C:\\Users\\me\\.bun\\bin',
        'C:\\Users\\me\\AppData\\Local\\Volta\\bin',
        'C:\\nvm4w\\nodejs',
        'C:\\Users\\me\\AppData\\Roaming\\fnm\\aliases\\default',
        'C:\\Users\\me\\scoop\\shims',
        'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links',
        'C:\\ProgramData\\chocolatey\\bin',
      ]),
    );
    // A standalone installer's folder beats a package manager's shim.
    expect(dirs.indexOf('C:\\Users\\me\\.local\\bin')).toBeLessThan(
      dirs.indexOf('C:\\Users\\me\\AppData\\Roaming\\npm'),
    );
  });

  it('reads variables case-insensitively, as Windows does, and drops duplicates', async () => {
    const dirs = await getUserBinDirs({
      env: { ...env, NVM_SYMLINK: undefined, nvm_symlink: 'D:\\node' },
      home,
      os: 'win32',
    });

    expect(dirs).toContain('D:\\node');
    expect(new Set(dirs.map((dir) => dir.toLowerCase())).size).toBe(dirs.length);
  });
});

describe('findCommandInUserBinDirs on macOS / Linux', () => {
  let home: string;

  const installAt = async (relativePath: string, mode = 0o755) => {
    const file = path.join(home, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '#!/usr/bin/env node\n');
    await chmod(file, mode);
    return file;
  };

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), 'user-bin-dirs-'));
  });

  afterEach(async () => {
    await rm(home, { force: true, recursive: true });
  });

  it("finds a CLI under every nvm Node, the default alias's first", async () => {
    const old = await installAt('.nvm/versions/node/v18.20.0/bin/codex');
    const newest = await installAt('.nvm/versions/node/v24.1.0/bin/codex');
    const current = await installAt('.nvm/versions/node/v22.3.0/bin/codex');
    await mkdir(path.join(home, '.nvm/alias'), { recursive: true });
    await writeFile(path.join(home, '.nvm/alias/default'), '22\n');

    await expect(
      findCommandInUserBinDirs(['codex'], { env: {}, home, os: 'linux' }),
    ).resolves.toEqual([current, newest, old]);
  });

  it("finds bun, fnm and .npmrc-prefix globals, and skips files that can't run", async () => {
    const viaBun = await installAt('.bun/bin/opencode');
    const viaFnm = await installAt('.local/share/fnm/node-versions/v20.1.0/installation/bin/dsh');
    const viaPrefix = await installAt('.npm-packages/bin/pi');
    await installAt('.local/bin/pi', 0o644);
    await writeFile(path.join(home, '.npmrc'), 'prefix=~/.npm-packages\n');

    const options = { env: {}, home, os: 'linux' as const };
    await expect(findCommandInUserBinDirs(['opencode'], options)).resolves.toEqual([viaBun]);
    await expect(findCommandInUserBinDirs(['dsh'], options)).resolves.toEqual([viaFnm]);
    await expect(findCommandInUserBinDirs(['pi'], options)).resolves.toEqual([viaPrefix]);
  });
});

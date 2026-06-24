import { describe, expect, it } from 'vitest';

import { buildInstallCommand, isNewerVersion } from './update';

describe('isNewerVersion', () => {
  it('compares core versions', () => {
    expect(isNewerVersion('1.2.3', '1.2.2')).toBe(true);
    expect(isNewerVersion('1.2.2', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('tolerates a leading v and missing segments', () => {
    expect(isNewerVersion('v1.2.0', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.3', '1.2.9')).toBe(true);
  });

  it('ranks a stable release above a prerelease of the same core', () => {
    expect(isNewerVersion('1.2.3', '1.2.3-beta.1')).toBe(true);
    expect(isNewerVersion('1.2.3-beta.1', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.3-beta.2', '1.2.3-beta.1')).toBe(true);
    expect(isNewerVersion('1.2.3-beta.1', '1.2.3-beta.1')).toBe(false);
  });

  it('orders numeric prerelease identifiers numerically, not lexicographically', () => {
    // The bug a raw string compare gets wrong: beta.10 must outrank beta.9.
    expect(isNewerVersion('1.0.0-beta.10', '1.0.0-beta.9')).toBe(true);
    expect(isNewerVersion('1.0.0-beta.9', '1.0.0-beta.10')).toBe(false);
    expect(isNewerVersion('1.0.0-beta.2', '1.0.0-beta.10')).toBe(false);
  });

  it('returns false for an unparseable latest version', () => {
    expect(isNewerVersion('not-a-version', '1.0.0')).toBe(false);
  });
});

describe('buildInstallCommand', () => {
  it('builds the global install command per package manager', () => {
    expect(buildInstallCommand('npm', '@lobehub/cli@1.0.0')).toEqual({
      args: ['install', '-g', '@lobehub/cli@1.0.0'],
      command: 'npm',
    });
    expect(buildInstallCommand('pnpm', '@lobehub/cli@1.0.0')).toEqual({
      args: ['add', '-g', '@lobehub/cli@1.0.0'],
      command: 'pnpm',
    });
    expect(buildInstallCommand('bun', '@lobehub/cli@1.0.0')).toEqual({
      args: ['add', '-g', '@lobehub/cli@1.0.0'],
      command: 'bun',
    });
    expect(buildInstallCommand('yarn', '@lobehub/cli@1.0.0')).toEqual({
      args: ['global', 'add', '@lobehub/cli@1.0.0'],
      command: 'yarn',
    });
  });
});

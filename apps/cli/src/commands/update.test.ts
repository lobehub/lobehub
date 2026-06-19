import { describe, expect, it } from 'vitest';

import { buildInstallCommand, compareSemver } from './update';

describe('compareSemver', () => {
  it('compares core versions', () => {
    expect(compareSemver('1.2.3', '1.2.2')).toBe(1);
    expect(compareSemver('1.2.2', '1.2.3')).toBe(-1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
  });

  it('tolerates a leading v and missing segments', () => {
    expect(compareSemver('v1.2.0', '1.2.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
    expect(compareSemver('1.3', '1.2.9')).toBe(1);
  });

  it('ranks a stable release above a prerelease of the same core', () => {
    expect(compareSemver('1.2.3', '1.2.3-beta.1')).toBe(1);
    expect(compareSemver('1.2.3-beta.1', '1.2.3')).toBe(-1);
    expect(compareSemver('1.2.3-beta.2', '1.2.3-beta.1')).toBe(1);
    expect(compareSemver('1.2.3-beta.1', '1.2.3-beta.1')).toBe(0);
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

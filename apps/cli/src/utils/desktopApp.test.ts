import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type DesktopAppLocation,
  CLI_SHIM_NAME,
  installShim,
  isDesktopChannel,
  platformExecutableNames,
  resolveShimDirectory,
  resolveShimPath,
  schemeFor,
  uninstallShim,
} from './desktopApp';

const location: DesktopAppLocation = {
  channel: 'stable',
  executablePath: '/Applications/LobeHub.app/Contents/MacOS/LobeHub',
  installPath: '/Applications/LobeHub.app',
};

describe('desktopApp shim', () => {
  let tempDir: string;
  const env = () => ({ LOBE_CLI_SHIM_DIR: tempDir }) as NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'lh-app-'));
  });

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('should write an exec wrapper that forwards arguments', () => {
    const result = installShim(location, env());

    expect(result.written).toBe(true);
    expect(result.path).toBe(path.join(tempDir, CLI_SHIM_NAME));

    const script = readFileSync(result.path, 'utf8');
    // Exec the bundle's binary, not a symlink: a symlink pins the channel that
    // happened to be installed when the shim was written.
    expect(script).toContain(`exec "${location.executablePath}" "$@"`);
  });

  it('should refuse to clobber a foreign binary with the same name', () => {
    const shimPath = resolveShimPath(env());
    writeFileSync(shimPath, '#!/bin/sh\necho not ours\n');

    const result = installShim(location, env());

    expect(result.written).toBe(false);
    expect(readFileSync(shimPath, 'utf8')).toContain('echo not ours');
  });

  it('should overwrite its own shim', () => {
    installShim(location, env());
    const second = installShim({ ...location, executablePath: '/elsewhere/LobeHub' }, env());

    expect(second.written).toBe(true);
    expect(readFileSync(second.path, 'utf8')).toContain('/elsewhere/LobeHub');
  });

  it('should only remove a shim it wrote', () => {
    expect(uninstallShim(env())).toBe(false);

    installShim(location, env());
    expect(uninstallShim(env())).toBe(true);

    writeFileSync(resolveShimPath(env()), '#!/bin/sh\necho not ours\n');
    expect(uninstallShim(env())).toBe(false);
  });

  it('should fall back to ~/.local/bin without an override', () => {
    expect(resolveShimDirectory({} as NodeJS.ProcessEnv)).toBe(
      path.join(os.homedir(), '.local', 'bin'),
    );
  });

  it('should create the shim directory when missing', () => {
    const nested = path.join(tempDir, 'a', 'b');
    const result = installShim(location, { LOBE_CLI_SHIM_DIR: nested } as NodeJS.ProcessEnv);

    expect(result.written).toBe(true);
    expect(statSync(result.path).isFile()).toBe(true);
  });
});

describe('schemeFor', () => {
  it('should keep stable on the bare scheme and suffix the channels', () => {
    // A nightly and a stable install coexist; each handoff addresses its own.
    expect(schemeFor({ ...location, channel: 'stable' })).toBe('lobehub');
    expect(schemeFor({ ...location, channel: 'beta' })).toBe('lobehub-beta');
    expect(schemeFor({ ...location, channel: 'nightly' })).toBe('lobehub-nightly');
  });
});

describe('isDesktopChannel', () => {
  it('should accept the known channels and reject anything else', () => {
    expect(isDesktopChannel('nightly')).toBe(true);
    expect(isDesktopChannel('canary')).toBe(false);
  });
});

describe('platformExecutableNames', () => {
  it('should use one constant Windows binary for every channel', () => {
    // electron-builder pins `win.executableName`; only the product — and with
    // it the install directory — carries the channel suffix.
    expect(platformExecutableNames('stable', 'win32')).toEqual(['LobeHub.exe']);
    expect(platformExecutableNames('beta', 'win32')).toEqual(['LobeHub.exe']);
    expect(platformExecutableNames('nightly', 'win32')).toEqual(['LobeHub.exe']);
  });

  it('should follow the product name on Linux', () => {
    expect(platformExecutableNames('stable', 'linux')).toContain('LobeHub');
    expect(platformExecutableNames('nightly', 'linux')).toContain('LobeHub-Nightly');
  });

  it('should not guess a binary name on macOS', () => {
    // The bundle's Contents/MacOS is read instead.
    expect(platformExecutableNames('stable', 'darwin')).toEqual([]);
  });
});

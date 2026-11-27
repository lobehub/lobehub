import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCliDirName } from '../constants/identity';
import { saveSettings } from '../settings';
import {
  acquireInstallLock,
  COMMAND_UPDATE_CHECK_INTERVAL_MS,
  isAutoUpdatableInstall,
  isAutoUpdateEnabled,
  isDaemonInstallRunning,
  isInstallLockHeld,
  maybeStartBackgroundUpdate,
  readAutoUpdateState,
  releaseInstallLock,
} from './autoUpdate';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawn,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: () => path.join(actual.default.tmpdir(), 'lobehub-cli-test-auto-update'),
    },
  };
});

const home = path.join(os.tmpdir(), 'lobehub-cli-test-auto-update');
const globalEntry = path.join(home, 'lib', 'node_modules', '@lobehub', 'cli', 'dist', 'index.js');
const ENV_KEYS = [
  'CI',
  'LOBEHUB_CLI_DISABLE_AUTOUPDATE',
  'LOBEHUB_OPERATION_ID',
  'LOBEHUB_TOPIC_ID',
];
const savedEnv: Record<string, string | undefined> = {};
const argv = (...args: string[]) => [process.execPath, globalEntry, ...args];

beforeEach(() => {
  fs.mkdirSync(path.dirname(globalEntry), { recursive: true });
  fs.writeFileSync(globalEntry, '');
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  spawn.mockReturnValue({ on: vi.fn(), unref: vi.fn() });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(home, { force: true, recursive: true });
  vi.clearAllMocks();
});

describe('isAutoUpdatableInstall', () => {
  it('accepts a package-manager global install', () => {
    expect(isAutoUpdatableInstall(globalEntry)).toBe(true);
  });

  it('rejects a source checkout and the desktop bundled copy', () => {
    const source = path.join(home, 'lobehub', 'apps', 'cli', 'dist', 'index.js');
    const desktop = path.join(home, 'core.asar.unpacked', 'cli', 'dist', 'index.js');
    for (const file of [source, desktop]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '');
      expect(isAutoUpdatableInstall(file)).toBe(false);
    }
  });

  it('follows a workspace link to its source checkout', () => {
    const source = path.join(home, 'lobehub', 'apps', 'cli');
    fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(source, 'dist', 'index.js'), '');
    const linked = path.join(home, 'linked', 'node_modules', '@lobehub', 'cli');
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.symlinkSync(source, linked);
    expect(isAutoUpdatableInstall(path.join(linked, 'dist', 'index.js'))).toBe(false);
  });
});

describe('isAutoUpdateEnabled', () => {
  it('is on by default and off after lh update --auto off', () => {
    expect(isAutoUpdateEnabled()).toBe(true);
    saveSettings({ autoUpdates: false });
    expect(isAutoUpdateEnabled()).toBe(false);
  });

  it('honours the environment opt-out, CI and agent runs', () => {
    process.env.LOBEHUB_CLI_DISABLE_AUTOUPDATE = '0';
    expect(isAutoUpdateEnabled()).toBe(true);
    process.env.LOBEHUB_CLI_DISABLE_AUTOUPDATE = '1';
    expect(isAutoUpdateEnabled()).toBe(false);
    delete process.env.LOBEHUB_CLI_DISABLE_AUTOUPDATE;
    expect(isAutoUpdateEnabled({ CI: 'true' })).toBe(false);
    expect(isAutoUpdateEnabled({ LOBEHUB_OPERATION_ID: 'op_1' })).toBe(false);
    expect(isAutoUpdateEnabled({ LOBEHUB_MANAGED_DEVICE_ID: 'dev_1' })).toBe(false);
  });
});

describe('maybeStartBackgroundUpdate', () => {
  it('starts one detached worker per day', () => {
    const now = 1_000_000_000_000;
    expect(maybeStartBackgroundUpdate(argv('task', 'list'), now)).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [globalEntry, 'auto-update-worker'],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(readAutoUpdateState().lastCheckAt).toBe(now);

    expect(maybeStartBackgroundUpdate(argv('task', 'list'), now + 1000)).toBe(false);
    expect(
      maybeStartBackgroundUpdate(argv('task', 'list'), now + COMMAND_UPDATE_CHECK_INTERVAL_MS),
    ).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('skips commands that update on their own or run in a hot path', () => {
    for (const args of [['update'], ['connect', '--daemon'], ['completion'], ['--version'], []]) {
      expect(maybeStartBackgroundUpdate(argv(...args))).toBe(false);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('does nothing when automatic updates are off', () => {
    saveSettings({ autoUpdates: false });
    expect(maybeStartBackgroundUpdate(argv('task', 'list'))).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('isDaemonInstallRunning', () => {
  it('reports a fresh daemon install and ignores a stale or finished one', () => {
    const dir = path.join(home, resolveCliDirName(), 'cli-maintenance');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'state.json');
    expect(isDaemonInstallRunning()).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ stage: 'updating' }));
    expect(isDaemonInstallRunning()).toBe(true);
    expect(isDaemonInstallRunning(Date.now() + 11 * 60 * 1000)).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ stage: 'restarting' }));
    expect(isDaemonInstallRunning()).toBe(false);
  });
});

describe('install lock', () => {
  it('admits one installer and takes over a stale lock', () => {
    const now = Date.now();
    expect(acquireInstallLock(now)).toBe(true);
    expect(acquireInstallLock(now)).toBe(false);
    expect(isInstallLockHeld(now)).toBe(true);
    expect(acquireInstallLock(now + 11 * 60 * 1000)).toBe(true);
    releaseInstallLock();
    expect(acquireInstallLock(now)).toBe(true);
    releaseInstallLock();
    expect(fs.existsSync(path.join(home, resolveCliDirName(), 'auto-update.lock'))).toBe(false);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCliDirName } from '../constants/identity';
import { log } from '../utils/logger';
import {
  loadActiveWorkspace,
  loadOrCreateConnectionId,
  loadSettings,
  normalizeUrl,
  resolveCommandMode,
  resolveSandboxNetwork,
  resolveServerUrl,
  saveActiveWorkspace,
  saveSettings,
} from './index';

const tmpDir = path.join(os.tmpdir(), 'lobehub-cli-test-settings');
// The shared test setup redirects the CLI home via `LOBEHUB_CLI_HOME`, so the
// directory under the stubbed homedir is not the default `.lobehub`.
const settingsDir = path.join(tmpDir, resolveCliDirName());
const settingsFile = path.join(settingsDir, 'settings.json');
const originalServer = process.env.LOBEHUB_SERVER;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: () => path.join(os.tmpdir(), 'lobehub-cli-test-settings'),
    },
  };
});

vi.mock('../utils/logger', () => ({
  log: {
    // `saveSettings` debug-logs when there is no file to unlink, which is the
    // ordinary path for a store holding only defaults.
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('settings', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    delete process.env.LOBEHUB_SERVER;
    delete process.env.LOBEHUB_CLI_COMMAND_MODE;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
    process.env.LOBEHUB_SERVER = originalServer;
    delete process.env.LOBEHUB_CLI_COMMAND_MODE;
    vi.clearAllMocks();
  });

  it('should save and load custom server and gateway settings', () => {
    saveSettings({
      gatewayUrl: 'https://gateway.example.com/',
      serverUrl: 'https://self-hosted.example.com/',
    });

    expect(loadSettings()).toEqual({
      gatewayUrl: 'https://gateway.example.com',
      serverUrl: 'https://self-hosted.example.com',
    });
  });

  it('should clear official server settings instead of persisting them', () => {
    saveSettings({ serverUrl: 'https://app.lobehub.com/' });

    expect(fs.existsSync(settingsFile)).toBe(false);
    expect(loadSettings()).toBeNull();
  });

  it('should warn when settings file exists but cannot be parsed', () => {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsFile, '{invalid json');

    expect(loadSettings()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Please delete this file'));
  });

  it('should normalize trailing slashes', () => {
    expect(normalizeUrl('https://self-hosted.example.com/')).toBe(
      'https://self-hosted.example.com',
    );
    expect(normalizeUrl(undefined)).toBeUndefined();
  });

  it('should prefer LOBEHUB_SERVER over settings', () => {
    saveSettings({ serverUrl: 'https://settings.example.com/' });
    process.env.LOBEHUB_SERVER = 'https://env.example.com/';

    expect(resolveServerUrl()).toBe('https://env.example.com');
  });

  it('should fall back to settings then official server', () => {
    saveSettings({ serverUrl: 'https://settings.example.com/' });

    expect(resolveServerUrl()).toBe('https://settings.example.com');

    fs.unlinkSync(settingsFile);

    expect(resolveServerUrl()).toBe('https://app.lobehub.com');
  });

  it('should persist the active workspace and clear it back to personal', () => {
    const record = {
      identity: 'user:u1',
      serverUrl: 'https://app.lobehub.com',
      workspaceId: 'ws_abc123',
    };
    saveActiveWorkspace(record);

    expect(loadActiveWorkspace()).toEqual(record);
    // Kept out of settings.json, which is unlinked whenever all URLs default.
    expect(fs.existsSync(path.join(settingsDir, 'active-workspace'))).toBe(true);

    saveActiveWorkspace(null);

    expect(loadActiveWorkspace()).toBeUndefined();
    expect(fs.existsSync(path.join(settingsDir, 'active-workspace'))).toBe(false);
  });

  it('should ignore a corrupt active-workspace file instead of scoping to garbage', () => {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'active-workspace'), 'not an id\n{"a":1}');

    expect(loadActiveWorkspace()).toBeUndefined();
  });

  // A record without the account/server it was chosen under cannot be checked
  // for staleness, so it must not be trusted.
  it.each([
    ['a missing identity', { serverUrl: 'https://app.lobehub.com', workspaceId: 'ws_1' }],
    ['a missing serverUrl', { identity: 'user:u1', workspaceId: 'ws_1' }],
    ['an id-shaped nothing', { identity: 'user:u1', serverUrl: 'https://x', workspaceId: 'a b' }],
  ])('should reject an active-workspace record with %s', (_label, record) => {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'active-workspace'), JSON.stringify(record));

    expect(loadActiveWorkspace()).toBeUndefined();
  });

  it('should create a connectionId once and reuse it across calls', () => {
    const first = loadOrCreateConnectionId();
    expect(first).toMatch(/[\da-f-]{36}/);

    // Persisted in its own file, independent of settings.json.
    expect(fs.existsSync(path.join(settingsDir, 'connection-id'))).toBe(true);
    expect(loadOrCreateConnectionId()).toBe(first);
  });

  it('should keep the connectionId even when settings.json is cleared', () => {
    const id = loadOrCreateConnectionId();
    // Clearing official-server settings unlinks settings.json — connectionId must survive.
    saveSettings({ serverUrl: 'https://app.lobehub.com/' });

    expect(fs.existsSync(settingsFile)).toBe(false);
    expect(loadOrCreateConnectionId()).toBe(id);
  });
  /**
   * The store deletes itself when it holds nothing but defaults, and a
   * distribution that compiles its own server URL in has users whose URLs are
   * ALL default. Before `command-mode` was added to that emptiness check,
   * saving it deleted the file it had just written — silently, on both the
   * write and the read back.
   */
  describe('command mode', () => {
    it('persists alongside default URLs rather than deleting the file', () => {
      saveSettings({ commandMode: 'sandbox' });

      expect(fs.existsSync(settingsFile)).toBe(true);
      expect(loadSettings()?.commandMode).toBe('sandbox');
      expect(resolveCommandMode()).toBe('sandbox');
    });

    it('survives an unrelated settings write', () => {
      saveSettings({ commandMode: 'sandbox' });
      const settings = loadSettings() ?? {};
      saveSettings({ ...settings, gatewayUrl: 'https://gateway.example.com' });

      expect(resolveCommandMode()).toBe('sandbox');
    });

    it('defaults to auto and stores nothing for it', () => {
      expect(resolveCommandMode()).toBe('auto');

      saveSettings({ commandMode: 'auto' });
      expect(fs.existsSync(settingsFile)).toBe(false);
    });

    it('ignores an unparseable stored value instead of failing every command', () => {
      fs.mkdirSync(settingsDir, { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify({ commandMode: 'nonsense' }));

      expect(resolveCommandMode()).toBe('auto');
    });

    it('lets the environment tighten the stored mode', () => {
      process.env.LOBEHUB_CLI_COMMAND_MODE = 'sandbox';

      expect(resolveCommandMode()).toBe('sandbox');
    });

    it('does not let the environment loosen the stored mode', () => {
      saveSettings({ commandMode: 'sandbox' });
      process.env.LOBEHUB_CLI_COMMAND_MODE = 'host';

      expect(resolveCommandMode()).toBe('sandbox');
    });

    it('ignores an unrecognised environment value', () => {
      process.env.LOBEHUB_CLI_COMMAND_MODE = 'yes-please';

      expect(resolveCommandMode()).toBe('auto');
      expect(log.warn).toHaveBeenCalled();
    });

    it('lets a pushed mode tighten but never loosen', () => {
      saveSettings({ commandMode: 'sandbox' });
      expect(resolveCommandMode('host')).toBe('sandbox');
      expect(resolveCommandMode('auto')).toBe('sandbox');

      saveSettings({ commandMode: undefined });
      expect(resolveCommandMode('sandbox')).toBe('sandbox');
    });

    it('persists the sandbox network preference on its own', () => {
      saveSettings({ sandboxNetwork: true });

      expect(fs.existsSync(settingsFile)).toBe(true);
      expect(resolveSandboxNetwork()).toBe(true);

      saveSettings({ sandboxNetwork: false });
      expect(fs.existsSync(settingsFile)).toBe(false);
      expect(resolveSandboxNetwork()).toBe(false);
    });
  });
});

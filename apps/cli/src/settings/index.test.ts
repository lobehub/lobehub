import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from '../utils/logger';
import { loadSettings, normalizeUrl, resolveServerUrl, saveSettings } from './index';

const tmpDir = path.join(os.tmpdir(), 'lobehub-cli-test-settings');
const settingsDir = path.join(tmpDir, '.lobehub');
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
    warn: vi.fn(),
  },
}));

describe('settings', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    delete process.env.LOBEHUB_SERVER;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
    process.env.LOBEHUB_SERVER = originalServer;
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
});

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rescuePath = fileURLToPath(new URL('../rescue/index.js', import.meta.url));
const updaterPath = fileURLToPath(new URL('../rescue/electron-updater.cjs', import.meta.url));
const require = createRequire(rescuePath);
const electronPath = require.resolve('electron');

const originalPlatform = process.platform;
let tmp;
let userData;
let resourcesPath;

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

const fakeUpdater = ({ check = async () => null } = {}) => {
  const listeners = {};
  let channel = null;
  return {
    allowDowngrade: false,
    get channel() {
      return channel;
    },
    set channel(value) {
      channel = value;
      this.allowDowngrade = false;
    },
    checkForUpdates: vi.fn(check),
    downloadUpdate: vi.fn(async () => {
      listeners['download-progress']?.({ percent: 42.7 });
    }),
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
    }),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  };
};

const fakeElectron = ({ response = 0 } = {}) => {
  const handlers = {};
  const app = {
    exit: vi.fn(),
    getLocale: () => 'en-US',
    getPath: () => userData,
    on: vi.fn((event, handler) => {
      handlers[event] = handler;
    }),
    relaunch: vi.fn(),
    releaseSingleInstanceLock: vi.fn(),
    whenReady: () => Promise.resolve(),
  };
  const texts = [];
  class BrowserWindow {
    webContents = {
      executeJavaScript: vi.fn(async (code) => {
        texts.push(code);
      }),
    };
    isDestroyed = () => false;
    loadURL = vi.fn(() => Promise.resolve());
  }
  return {
    app,
    BrowserWindow,
    dialog: { showMessageBox: vi.fn(async () => ({ response })) },
    handlers,
    shell: { openExternal: vi.fn(() => Promise.resolve()) },
    texts,
  };
};

const loadRescue = (electron, updater) => {
  require.cache[electronPath] = { exports: electron, id: electronPath, loaded: true };
  if (updater instanceof Error) {
    require.cache[updaterPath] = {
      get exports() {
        throw updater;
      },
      id: updaterPath,
      loaded: true,
    };
  } else if (updater) {
    require.cache[updaterPath] = {
      exports: { autoUpdater: updater },
      id: updaterPath,
      loaded: true,
    };
  }
  delete require.cache[rescuePath];
  return require(rescuePath);
};

const run = async (electron, updater) => {
  const fallback = vi.fn();
  loadRescue(electron, updater).runRescue({
    downloadUrl: 'https://example.com/downloads',
    error: new Error('core boom'),
    fallback,
    log: ['shell line'],
  });
  await vi.waitFor(() =>
    expect(
      electron.app.exit.mock.calls.length +
        fallback.mock.calls.length +
        (updater?.quitAndInstall?.mock.calls.length ?? 0),
    ).toBeGreaterThan(0),
  );
  return { fallback };
};

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-rescue-'));
  userData = path.join(tmp, 'userData');
  resourcesPath = process.resourcesPath;
  process.resourcesPath = path.join(tmp, 'resources');
  fs.mkdirSync(process.resourcesPath, { recursive: true });
  fs.writeFileSync(
    path.join(process.resourcesPath, 'app-update.yml'),
    'provider: generic\nurl: https://releases.example.com/canary\n',
  );
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  for (const file of [electronPath, rescuePath, updaterPath]) delete require.cache[file];
  process.resourcesPath = resourcesPath;
  fs.rmSync(tmp, { force: true, recursive: true });
});

describe('rescue config', () => {
  const { resolveChannel, resolveFeedUrl, configureUpdater } = (() => {
    require.cache[electronPath] = { exports: {}, id: electronPath, loaded: true };
    delete require.cache[rescuePath];
    const mod = require(rescuePath);
    delete require.cache[electronPath];
    return mod;
  })();

  it.each([
    ['canary', undefined, 'canary'],
    ['stable', 'canary', 'stable'],
    ['nightly', undefined, 'stable'],
    [undefined, 'beta', 'canary'],
    [undefined, 'canary', 'canary'],
    [undefined, 'stable', 'stable'],
    [undefined, undefined, 'canary'],
  ])('stored %s with builtin %s resolves to %s', (stored, built, expected) => {
    if (stored) writeJson(path.join(userData, 'lobehub-settings.json'), { updateChannel: stored });
    if (built)
      writeJson(path.join(process.resourcesPath, 'core.asar', 'manifest.json'), { channel: built });
    expect(resolveChannel({ resourcesPath: process.resourcesPath, userData })).toBe(expected);
  });

  it('re-roots the app-update.yml feed on the resolved channel', () => {
    expect(resolveFeedUrl({ channel: 'stable', resourcesPath: process.resourcesPath })).toBe(
      'https://releases.example.com/stable',
    );
  });

  it('accepts a quoted url and leaves github builds to app-update.yml', () => {
    const yml = path.join(process.resourcesPath, 'app-update.yml');
    fs.writeFileSync(yml, "provider: generic\nurl: 'https://r.example.com/'\n");
    expect(resolveFeedUrl({ channel: 'canary', resourcesPath: process.resourcesPath })).toBe(
      'https://r.example.com/canary',
    );
    fs.writeFileSync(yml, 'provider: github\nowner: lobehub\nrepo: lobehub\n');
    expect(resolveFeedUrl({ channel: 'canary', resourcesPath: process.resourcesPath })).toBe(
      undefined,
    );
  });

  it('keeps downgrades allowed after the channel setter resets them', () => {
    const updater = fakeUpdater();
    configureUpdater(updater, { channel: 'canary', feedUrl: 'https://f/canary', logger: {} });
    expect(updater.channel).toBe('canary');
    expect(updater.allowDowngrade).toBe(true);
    expect(updater.allowPrerelease).toBe(true);
    expect(updater.autoDownload).toBe(false);
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://f/canary',
    });
  });
});

describe('runRescue', () => {
  it('checks the packaged canary feed before an update-channel setting exists', async () => {
    writeJson(path.join(process.resourcesPath, 'core.asar', 'manifest.json'), {
      channel: 'canary',
    });
    const electron = fakeElectron({ response: 2 });
    const updater = fakeUpdater({ check: async () => ({ isUpdateAvailable: false }) });

    await run(electron, updater);

    expect(updater.channel).toBe('canary');
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://releases.example.com/canary',
    });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it('downloads and installs an available update', async () => {
    const electron = fakeElectron();
    const updater = fakeUpdater({
      check: async () => ({ isUpdateAvailable: true, updateInfo: { version: '2.0.0' } }),
    });
    await run(electron, updater);

    expect(updater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://releases.example.com/canary',
    });
    expect(updater.downloadUpdate).toHaveBeenCalled();
    expect(electron.app.releaseSingleInstanceLock).toHaveBeenCalled();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(electron.texts.join('\n')).toMatch(/Downloading update… 42%/);

    electron.handlers['window-all-closed']();
    expect(electron.app.exit).not.toHaveBeenCalled();
  });

  it('surfaces an install failure reported after quitAndInstall instead of hanging', async () => {
    const electron = fakeElectron({ response: 2 });
    const updater = fakeUpdater({
      check: async () => ({ isUpdateAvailable: true, updateInfo: { version: '2.0.0' } }),
    });
    await run(electron, updater);
    const onError = updater.on.mock.calls.find(([event]) => event === 'error')[1];

    onError(new Error('Could not locate update bundle'));

    await vi.waitFor(() => expect(electron.app.exit).toHaveBeenCalledWith(1));
    expect(electron.dialog.showMessageBox.mock.calls[0][1].message).toMatch(/Failed/);
  });

  it('ignores updater error events that the check already reported', async () => {
    const electron = fakeElectron({ response: 2 });
    const updater = fakeUpdater({
      check: async () => {
        throw new Error('offline');
      },
    });
    await run(electron, updater);
    const onError = updater.on.mock.calls.find(([event]) => event === 'error')[1];

    onError(new Error('offline'));

    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('offers a retry launch that clears the boot counter when already on the latest version', async () => {
    writeJson(path.join(userData, 'core-ota', 'boot.json'), { failures: 3, version: 'builtin@1' });
    const electron = fakeElectron({ response: 0 });
    await run(electron, fakeUpdater({ check: async () => ({ isUpdateAvailable: false }) }));

    expect(electron.dialog.showMessageBox.mock.calls[0][1].message).toMatch(/latest version/);
    expect(fs.existsSync(path.join(userData, 'core-ota', 'boot.json'))).toBe(false);
    expect(electron.app.relaunch).toHaveBeenCalled();
    expect(electron.app.exit).toHaveBeenCalledWith(0);
  });

  it('opens the download page when the check fails', async () => {
    const electron = fakeElectron({ response: 1 });
    await run(
      electron,
      fakeUpdater({
        check: async () => {
          throw new Error('offline');
        },
      }),
    );

    expect(electron.dialog.showMessageBox.mock.calls[0][1].message).toMatch(/Failed/);
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://example.com/downloads');
    expect(electron.app.exit).toHaveBeenCalledWith(1);
  });

  it('treats an inactive updater as a failure instead of claiming the app is up to date', async () => {
    const electron = fakeElectron({ response: 2 });
    await run(electron, fakeUpdater({ check: async () => null }));

    expect(electron.dialog.showMessageBox.mock.calls[0][1].message).toMatch(/Failed/);
    expect(electron.app.exit).toHaveBeenCalledWith(1);
  });

  it('hands over to the fallback when the vendored updater cannot load', async () => {
    const electron = fakeElectron();
    const { fallback } = await run(electron, new Error('missing bundle'));

    expect(fallback).toHaveBeenCalled();
  });

  it('logs the core failure and shell log for support', async () => {
    const electron = fakeElectron({ response: 2 });
    await run(electron, fakeUpdater({ check: async () => ({ isUpdateAvailable: false }) }));

    const log = fs.readFileSync(path.join(userData, 'logs', 'shell-rescue.log'), 'utf8');
    expect(log).toMatch(/core boom/);
    expect(log).toMatch(/shell: shell line/);
  });
});

describe('vendored electron-updater', () => {
  it('matches the installed electron-updater version (run `bun run shell:vendor`)', () => {
    const banner = fs.readFileSync(updaterPath, 'utf8').split('\n', 1)[0];
    const { version } = require('electron-updater/package.json');
    expect(banner).toBe(`/* electron-updater@${version} generated by shell:vendor */`);
  });
});

describe('macOS Sparkle rescue', () => {
  it('repairs a broken Canary core through Sparkle without loading electron-updater', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const electron = fakeElectron();
    const addonFile = path.join(process.resourcesPath, 'sparkle', 'sparkle_bridge.node');
    fs.mkdirSync(path.dirname(addonFile), { recursive: true });
    fs.writeFileSync(addonFile, '');
    const addonPath = require.resolve(addonFile);
    let emit;
    const bridge = {
      init: vi.fn(() => true),
      setAutomaticChecks: vi.fn(),
      setEventHandler: vi.fn((handler) => {
        emit = handler;
      }),
      checkForUpdates: vi.fn(() => {
        emit({ type: 'update-available', version: '2.0.0-canary.1' });
        emit({ type: 'update-downloaded', version: '2.0.0-canary.1' });
      }),
      installUpdateNow: vi.fn(),
    };
    require.cache[addonPath] = { exports: bridge, id: addonPath, loaded: true };
    const fallback = vi.fn();
    try {
      loadRescue(electron, new Error('legacy updater must not load')).runRescue({
        downloadUrl: 'https://example.com/downloads',
        error: new Error('broken core'),
        fallback,
      });
      await vi.waitFor(() => expect(bridge.installUpdateNow).toHaveBeenCalledOnce());
      expect(bridge.init).toHaveBeenCalledWith({
        appcastUrl: `https://releases.example.com/canary/appcast-${process.arch}.xml`,
      });
      expect(fallback).not.toHaveBeenCalled();
      expect(electron.app.releaseSingleInstanceLock).toHaveBeenCalledOnce();
      const quit = electron.app.on.mock.calls.find(([event]) => event === 'will-quit')?.[1];
      quit();
      expect(bridge.setEventHandler).toHaveBeenLastCalledWith(null);
    } finally {
      delete require.cache[addonPath];
    }
  });
});

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const hostPlatform = process.platform;
const entry = require.resolve('../update');
const electron = require.resolve('electron');
const rescue = require.resolve('../rescue');
const sparklePath = require.resolve('../rescue/sparkle');
const updaterPath = require.resolve('../rescue/electron-updater.cjs');
let updater;
let userData, window, handler, app, online, createStartupUpdate, Window;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const marker = () =>
  JSON.parse(fs.readFileSync(path.join(userData, 'startup-update.json'), 'utf8'));
const action = (value) => handler({ sender: window.webContents }, value);
beforeEach(() => {
  window = undefined;
  online = true;
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-update-'));
  app = Object.assign(new EventEmitter(), {
    exit: vi.fn(),
    quit: vi.fn(),
    getLocale: () => 'zh-CN',
    getPath: () => userData,
    whenReady: async () => {},
    releaseSingleInstanceLock: vi.fn(),
    relaunch: vi.fn(),
  });
  const windows = [];
  Window = class extends EventEmitter {
    static getAllWindows() {
      return windows.filter((win) => !win.isDestroyed());
    }
    constructor() {
      super();
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- Expose the fake native window to the test.
      window = this;
      windows.push(this);
      this.enabled = true;
      app.emit('browser-window-created', {}, this);
      this.webContents = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      });
    }
    center() {}
    isEnabled() {
      return this.enabled;
    }
    setEnabled(enabled) {
      this.enabled = enabled;
    }
    destroy() {
      this.destroyed = true;
      if (!app.emit('window-all-closed')) app.quit();
    }
    isDestroyed() {
      return this.destroyed;
    }
    async loadFile() {}
    show() {
      this.shown = true;
    }
    focus() {}
  };
  require.cache[electron] = {
    exports: {
      app,
      BrowserWindow: Window,
      nativeTheme: {},
      net: { isOnline: () => online },
      ipcMain: {
        handle: (_channel, callback) => {
          handler = callback;
        },
        removeHandler: vi.fn(),
      },
    },
  };
  require.cache[rescue] = {
    exports: {
      configureUpdater: vi.fn(),
      resolveChannel: () => 'stable',
      resolveFeedUrl: () => 'https://updates.test',
    },
    loaded: true,
  };
  updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: '2.0.0' },
    })),
    downloadUpdate: vi.fn(async () => {
      updater.emit('download-progress', { percent: 45 });
    }),
    quitAndInstall: vi.fn(),
  });
  require.cache[updaterPath] = { exports: { autoUpdater: updater }, loaded: true };
  require.cache[sparklePath] = { exports: { createSparkleUpdater: () => updater }, loaded: true };
  delete require.cache[entry];
  ({ createStartupUpdate } = require(entry));
});
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: hostPlatform });
  for (const file of [entry, electron, rescue, updaterPath, sparklePath])
    delete require.cache[file];
  fs.rmSync(userData, { recursive: true, force: true });
});
it('keeps first launch pending until the check passes and the business renderer is healthy', async () => {
  const gate = createStartupUpdate({ userData, channel: 'canary' });
  gate.markHealthy();
  expect(marker().completed).toBe(false);
  await expect(gate.run(async () => 'ready')).resolves.toBe(true);
  expect(window.isDestroyed()).toBe(true);
  expect(app.quit).not.toHaveBeenCalled();
  expect(marker().completed).toBe(false);
  gate.markHealthy();
  expect(marker().completed).toBe(true);
  const check = vi.fn();
  await createStartupUpdate({ userData, channel: 'canary' }).run(check);
  expect(check).not.toHaveBeenCalled();
});
it('migrates existing installations without forcing them through first launch again', async () => {
  fs.writeFileSync(path.join(userData, 'lobehub-settings.json'), '{}');
  const check = vi.fn();
  await expect(createStartupUpdate({ userData, channel: 'canary' }).run(check)).resolves.toBe(true);
  expect(check).not.toHaveBeenCalled();
});
it('shows a recoverable error, ignores concurrent retries, and completes after a successful retry', async () => {
  let resume;
  const check = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
  const result = createStartupUpdate({ userData, channel: 'canary' }).run(check);
  await flush();
  expect(action('state')).toMatchObject({ phase: 'error', language: 'zh-CN' });
  expect(window.shown).toBe(true);
  expect(marker().completed).toBe(false);
  action('retry');
  action('retry');
  expect(check).toHaveBeenCalledTimes(2);
  expect(() => handler({ sender: {} }, 'quit')).toThrow('Untrusted');
  resume('ready');
  await expect(result).resolves.toBe(true);
});
it('quits without completing first launch and retries the gate on the next launch', async () => {
  const result = createStartupUpdate({ userData, channel: 'canary' }).run(async () => {
    throw new Error('offline');
  });
  await flush();
  action('quit');
  await expect(result).resolves.toBe(false);
  expect(app.exit).toHaveBeenCalledWith(0);
  expect(createStartupUpdate({ userData, channel: 'canary' }).pending).toBe(true);
  expect(app.listenerCount('activate')).toBe(0);
});

it('uses the full installer when required and leaves first launch pending until the new app boots', async () => {
  updater.downloadUpdate.mockRejectedValueOnce(new Error('download failed'));
  const result = createStartupUpdate({ userData, channel: 'canary' }).run(
    async () => 'full-update',
  );
  await flush();
  expect(action('state').phase).toBe('error');
  expect(updater.quitAndInstall).not.toHaveBeenCalled();
  action('retry');
  await flush();
  expect(window.webContents.send).toHaveBeenCalledWith(
    'shell:update-state',
    expect.objectContaining({ phase: 'downloading', percent: 45 }),
  );
  expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  expect(app.releaseSingleInstanceLock).toHaveBeenCalledOnce();
  expect(marker().completed).toBe(false);
  action('quit');
  await result;
  expect(updater.listenerCount('download-progress')).toBe(0);
});

it('opens the app without a window when first launch starts offline', async () => {
  online = false;
  const gate = createStartupUpdate({ userData, channel: 'canary' });
  const check = vi.fn();
  await expect(gate.run(check)).resolves.toBe(true);
  expect(check).not.toHaveBeenCalled();
  expect(window).toBeUndefined();
  gate.markHealthy();
  expect(marker().completed).toBe(true);
});

it('never shows the window when the check finishes quickly', async () => {
  await expect(
    createStartupUpdate({ userData, channel: 'canary' }).run(async () => 'ready'),
  ).resolves.toBe(true);
  expect(window.shown).toBeUndefined();
});

it('shows the window only once the check outlasts the delay', async () => {
  vi.useFakeTimers();
  try {
    let resume;
    const result = createStartupUpdate({ userData, channel: 'canary' }).run(
      () =>
        new Promise((resolve) => {
          resume = resolve;
        }),
    );
    await vi.advanceTimersByTimeAsync(599);
    expect(window.shown).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(window.shown).toBe(true);
    resume('ready');
    await expect(result).resolves.toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('opens the app instead of an error when the network drops during the update', async () => {
  const gate = createStartupUpdate({ userData, channel: 'canary' });
  const result = gate.run(async () => {
    online = false;
    throw new Error('net::ERR_INTERNET_DISCONNECTED');
  });
  await expect(result).resolves.toBe(true);
  expect(window.isDestroyed()).toBe(true);
  gate.markHealthy();
  expect(marker().completed).toBe(true);
});

for (const channel of ['stable', 'nightly']) {
  it(`skips the first-launch OTA gate for a ${channel} installer`, async () => {
    const check = vi.fn();
    const gate = createStartupUpdate({ userData, channel });
    await expect(gate.run(check)).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
    expect(window).toBeUndefined();
  });
}
it('lets Stable enter while a delayed security fetch is still pending, then forces the update', async () => {
  let finishCheck;
  const security = {
    check: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishCheck = resolve;
          }),
      )
      .mockResolvedValue(true),
    isInstallerSafe: () => true,
  };
  const gate = createStartupUpdate({ userData, channel: 'stable' });
  const check = vi.fn();
  await expect(gate.run(check)).resolves.toBe(true);
  const business = new Window();
  const background = gate.checkSecurity(security);
  expect(gate.checkSecurity(security)).toBe(background);
  await flush();
  expect(window).toBe(business);
  expect(business.isEnabled()).toBe(true);
  expect(check).not.toHaveBeenCalled();
  finishCheck(true);
  await flush();
  expect(window).not.toBe(business);
  expect(business.isEnabled()).toBe(false);
  expect(action('state').reason).toBe('required');
  action('quit');
  await expect(background).resolves.toBe(false);
});

it('keeps business windows interactive when the background policy does not match', async () => {
  const business = new Window();
  await createStartupUpdate({ userData, channel: 'stable' }).checkSecurity({
    check: async () => false,
    isInstallerSafe: () => true,
  });
  expect(window).toBe(business);
  expect(business.isEnabled()).toBe(true);
});

it('exits if the mandatory update window cannot load after a confirmed match', async () => {
  vi.spyOn(Window.prototype, 'loadFile').mockRejectedValueOnce(new Error('missing update UI'));
  const result = await createStartupUpdate({ userData, channel: 'stable' }).checkSecurity({
    check: async () => true,
    isInstallerSafe: () => true,
  });
  expect(result).toBe(false);
  expect(app.exit).toHaveBeenCalledWith(1);
});

it('blocks existing and newly created windows until a newer policy revokes the restriction', async () => {
  const business = new Window();
  const alreadyDisabled = new Window();
  alreadyDisabled.setEnabled(false);
  const security = {
    check: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false),
    isInstallerSafe: () => true,
  };
  updater.checkForUpdates.mockRejectedValueOnce(new Error('unavailable'));
  const result = createStartupUpdate({ userData, channel: 'stable' }).checkSecurity(security);
  await flush();
  const requiredWindow = window;
  const newBusiness = new Window();
  expect(business.isEnabled()).toBe(false);
  expect(newBusiness.isEnabled()).toBe(false);
  expect(requiredWindow.isEnabled()).toBe(true);
  window = requiredWindow;
  action('retry');
  await expect(result).resolves.toBe(true);
  expect(business.isEnabled()).toBe(true);
  expect(newBusiness.isEnabled()).toBe(true);
  expect(alreadyDisabled.isEnabled()).toBe(false);
  expect(app.listenerCount('browser-window-created')).toBe(0);
});
for (const channel of ['stable', 'canary']) {
  it.each(['darwin', 'win32', 'linux'])(
    `requires a safe full installer for an existing ${channel} installation on %s`,
    async (platform) => {
      Object.defineProperty(process, 'platform', { value: platform });
      fs.writeFileSync(path.join(userData, 'startup-update.json'), '{"completed":true}');
      const check = vi.fn();
      const security = { check: vi.fn(async () => true), isInstallerSafe: (v) => v === '2.0.0' };
      updater.checkForUpdates.mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: '1.0.0' },
      });
      const result = createStartupUpdate({ userData, channel }).checkSecurity(security);
      await flush();
      expect(action('state')).toMatchObject({ reason: 'required', phase: 'error' });
      expect(updater.downloadUpdate).not.toHaveBeenCalled();
      expect(updater.quitAndInstall).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
      action('retry');
      await flush();
      expect(updater.quitAndInstall).toHaveBeenCalledOnce();
      action('quit');
      await expect(result).resolves.toBe(false);
    },
  );
}
it('cannot bypass a known security restriction by going offline', async () => {
  online = false;
  updater.checkForUpdates.mockRejectedValue(new Error('offline'));
  const result = createStartupUpdate({ userData, channel: 'stable' }).checkSecurity({
    check: async () => true,
    isInstallerSafe: () => true,
  });
  await flush();
  expect(action('state')).toMatchObject({ reason: 'required', phase: 'error' });
  expect(window.isDestroyed()).toBeFalsy();
  action('quit');
  await expect(result).resolves.toBe(false);
});
it('allows entry when a newer policy revokes the restriction on retry', async () => {
  const security = {
    check: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false),
    isInstallerSafe: () => true,
  };
  updater.checkForUpdates.mockRejectedValueOnce(new Error('unavailable'));
  const result = createStartupUpdate({ userData, channel: 'stable' }).checkSecurity(security);
  await flush();
  action('retry');
  await expect(result).resolves.toBe(true);
});

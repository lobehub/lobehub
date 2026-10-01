const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, nativeTheme, net } = require('electron');

const { configureUpdater, resolveChannel, resolveFeedUrl } = require('../rescue');

const ACTION = 'shell:update-action';
const STATE = 'shell:update-state';
const SHOW_DELAY = 600;

// This runs in the synchronous shell boot chain, before Core creates its settings file.
function createStartupUpdate({ userData }) {
  const marker = path.join(userData, 'startup-update.json');
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(marker, 'utf8')).completed !== true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    pending = !fs.existsSync(path.join(userData, 'lobehub-settings.json'));
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ completed: !pending }));
  }
  let approved = false;
  return {
    pending,
    run: async (check) => {
      if (!pending) return true;
      await app.whenReady();
      // Offline first launch opens the app; Core's background check picks the update up later.
      approved = !net.isOnline() || (await runUpdateWindow({ check, reason: 'first-launch' }));
      return approved;
    },
    markHealthy: () => {
      if (!pending || !approved) return;
      fs.writeFileSync(`${marker}.tmp`, JSON.stringify({ completed: true }));
      fs.renameSync(`${marker}.tmp`, marker);
      pending = false;
    },
  };
}

// Shared blocking surface: future required-version policy can call it with reason: 'required'.
async function runUpdateWindow({ check, reason }) {
  await app.whenReady();
  const win = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#fafafa',
    height: 300,
    maximizable: false,
    minimizable: false,
    resizable: false,
    show: false,
    title: 'LobeHub',
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
    },
    width: 420,
  });
  win.center();
  const focus = () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  };
  app.on('activate', focus);
  app.on('second-instance', focus);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const language = app.getLocale().startsWith('zh') ? 'zh-CN' : 'en-US';
  const strings = require('./strings.json')[language];
  let state = { language, phase: 'checking', reason, strings };
  const update = (next) => {
    state = { language, reason, strings, ...next };
    if (!win.isDestroyed()) win.webContents.send(STATE, state);
  };
  let busy = false;
  let installing = false;
  let allowClose = false;
  let updater;
  let settled;
  const result = new Promise((resolve) => {
    settled = resolve;
  });
  const quit = () => {
    settled(false);
    app.exit(0);
  };
  win.on('close', (event) => {
    if (allowClose || installing) return;
    event.preventDefault();
    quit();
  });
  const finish = () => {
    // Keep Electron alive across the gap before Core creates its first window.
    app.once('window-all-closed', () => {});
    allowClose = true;
    settled(true);
    if (!win.isDestroyed()) win.destroy();
  };
  const fail = (error) => {
    installing = false;
    busy = false;
    if (reason === 'first-launch' && !net.isOnline()) {
      console.warn('[shell:update] Network lost, opening LobeHub', error);
      finish();
      return;
    }
    console.error('[shell:update] Update failed', error);
    update({ phase: 'error' });
    focus();
  };
  const onDownload = ({ percent }) => update({ phase: 'downloading', percent });
  const onInstallError = (error) => {
    if (installing) fail(error);
  };
  const attempt = async () => {
    if (busy) return;
    busy = true;
    update({ phase: 'checking' });
    try {
      const outcome = await check(update);
      if (win.isDestroyed()) return;
      if (outcome === 'ready') {
        finish();
      } else if (outcome === 'relaunch') {
        update({ phase: 'applying' });
        app.releaseSingleInstanceLock();
        app.relaunch(
          process.env.APPIMAGE
            ? { args: process.argv.slice(1), execPath: process.env.APPIMAGE }
            : { args: process.argv.slice(1) },
        );
        app.exit(0);
      } else if (outcome === 'full-update') {
        if (!updater) {
          updater = require('../rescue/electron-updater.cjs').autoUpdater;
          const channel = resolveChannel({
            resourcesPath: process.resourcesPath,
            userData: app.getPath('userData'),
          });
          const feedUrl = resolveFeedUrl({ channel, resourcesPath: process.resourcesPath });
          configureUpdater(updater, { channel, feedUrl, logger: console });
          updater.on('download-progress', onDownload);
          updater.on('error', onInstallError);
        }
        let timeout;
        const found = await Promise.race([
          updater.checkForUpdates(),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Installer check timed out')), 30000);
          }),
        ]).finally(() => clearTimeout(timeout));
        if (!found?.isUpdateAvailable)
          throw new Error('A compatible installer is not available yet');
        update({ phase: 'downloading' });
        await updater.downloadUpdate();
        update({ phase: 'applying' });
        installing = true;
        updater.quitAndInstall(true, true);
      } else {
        throw new Error(`Unexpected update outcome: ${outcome}`);
      }
    } catch (error) {
      fail(error);
    }
  };
  ipcMain.handle(ACTION, (event, action) => {
    if (event.sender !== win.webContents) throw new Error('Untrusted update window');
    if (action === 'state') return state;
    if (action === 'retry') {
      void attempt();
      return;
    }
    if (action === 'quit') quit();
  });
  let showTimer;
  try {
    await win.loadFile(path.join(__dirname, 'index.html'));
    void attempt();
    showTimer = setTimeout(focus, reason === 'required' ? 0 : SHOW_DELAY);
    return await result;
  } finally {
    clearTimeout(showTimer);
    app.removeListener('activate', focus);
    app.removeListener('second-instance', focus);
    ipcMain.removeHandler(ACTION);
    updater?.removeListener('download-progress', onDownload);
    updater?.removeListener('error', onInstallError);
    if (!win.isDestroyed()) {
      allowClose = true;
      win.destroy();
    }
  }
}

module.exports = { createStartupUpdate, runUpdateWindow };

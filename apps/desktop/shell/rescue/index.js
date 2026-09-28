const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, shell } = require('electron');

const CHECK_TIMEOUT_MS = 30_000;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

const resolveChannel = ({ resourcesPath, userData }) => {
  const stored = readJson(path.join(userData, 'lobehub-settings.json'))?.updateChannel;
  if (stored != null) return stored === 'canary' ? 'canary' : 'stable';
  const built = readJson(path.join(resourcesPath, 'core', 'manifest.json'))?.channel;
  return built === 'canary' || built === 'beta' ? 'canary' : 'stable';
};

const resolveFeedUrl = ({ channel, resourcesPath }) => {
  try {
    const yml = fs.readFileSync(path.join(resourcesPath, 'app-update.yml'), 'utf8');
    const url = /^url:\s*['"]?([^\s'"]+)/m.exec(yml)?.[1];
    if (!url) return undefined;
    return `${url.replace(/\/(stable|nightly|canary|beta)\/?$/, '').replace(/\/$/, '')}/${channel}`;
  } catch {
    return undefined;
  }
};

const configureUpdater = (autoUpdater, { channel, feedUrl, logger }) => {
  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = channel !== 'stable';
  if (feedUrl) {
    autoUpdater.channel = channel;
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  }
  // The channel setter flips allowDowngrade; republishing an older yml is how a broken
  // release gets rolled back, so rescue must accept it.
  autoUpdater.allowDowngrade = true;
};

const strings = (zh) =>
  zh
    ? {
        checking: 'LobeHub 启动失败，正在检查更新…',
        downloadPage: '打开下载页',
        downloading: (percent) => `正在下载更新… ${percent}%`,
        failed: '检查或下载更新失败',
        installing: '下载完成，正在安装…',
        latest: 'LobeHub 启动失败，且当前已是最新版本。',
        quit: '退出',
        retryCheck: '重试',
        retryLaunch: '重试启动',
      }
    : {
        checking: 'LobeHub failed to start. Checking for updates…',
        downloadPage: 'Open download page',
        downloading: (percent) => `Downloading update… ${percent}%`,
        failed: 'Failed to check for or download the update',
        installing: 'Download complete. Installing…',
        latest: 'LobeHub failed to start and is already on the latest version.',
        quit: 'Quit',
        retryCheck: 'Retry',
        retryLaunch: 'Retry launch',
      };

const createStatusWindow = (text) => {
  const win = new BrowserWindow({
    height: 140,
    maximizable: false,
    minimizable: false,
    resizable: false,
    title: 'LobeHub',
    webPreferences: { contextIsolation: true, javascript: true, nodeIntegration: false },
    width: 420,
  });
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:14px system-ui;padding:0 24px;text-align:center"><p id="s"></p>`;
  const ready = win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const setText = (value) =>
    ready
      .then(() =>
        win.isDestroyed()
          ? undefined
          : win.webContents.executeJavaScript(
              `document.getElementById('s').textContent = ${JSON.stringify(value)}`,
            ),
      )
      .catch(() => {});
  setText(text);
  return { setText, win };
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);

function runRescue({ downloadUrl, error, fallback, log = [] }) {
  const userData = app.getPath('userData');
  const logFile = path.join(userData, 'logs', 'shell-rescue.log');
  const write = (level, ...args) => {
    const line = args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' ');
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] [${level}] ${line}\n`);
    } catch {
      // an unwritable log dir must not stop the rescue flow
    }
  };
  const logger = {
    debug: (...args) => write('debug', ...args),
    error: (...args) => write('error', ...args),
    info: (...args) => write('info', ...args),
    warn: (...args) => write('warn', ...args),
  };

  logger.error('core failed to start', error);
  for (const entry of log) logger.info(`shell: ${entry}`);

  const channel = resolveChannel({ resourcesPath: process.resourcesPath, userData });
  const feedUrl = resolveFeedUrl({ channel, resourcesPath: process.resourcesPath });
  logger.info(`channel=${channel} feed=${feedUrl ?? '(app-update.yml)'}`);

  let installing = false;
  // quitAndInstall closes every window before Squirrel.Mac takes over; exiting there would
  // abort the install.
  app.on('window-all-closed', () => {
    if (!installing) app.exit(0);
  });

  app
    .whenReady()
    .then(() => {
      const { autoUpdater } = require('./electron-updater.cjs');
      configureUpdater(autoUpdater, { channel, feedUrl, logger });

      const t = strings(app.getLocale().startsWith('zh'));
      const status = createStatusWindow(t.checking);

      const choose = async (message, buttons) => {
        const { response } = await dialog.showMessageBox(status.win, {
          buttons: buttons.map(([label]) => label),
          cancelId: buttons.length - 1,
          defaultId: 0,
          message,
          type: 'error',
        });
        return buttons[response][1]();
      };
      const openDownloadPage = () => shell.openExternal(downloadUrl).finally(() => app.exit(1));
      const quit = () => app.exit(1);

      autoUpdater.on('download-progress', ({ percent }) =>
        status.setText(t.downloading(Math.floor(percent))),
      );

      const attempt = async () => {
        status.setText(t.checking);
        try {
          const result = await withTimeout(autoUpdater.checkForUpdates(), CHECK_TIMEOUT_MS);
          if (!result) throw new Error('updater is not active for this build');
          if (!result.isUpdateAvailable) {
            logger.info('no update available');
            return choose(t.latest, [
              [
                t.retryLaunch,
                () => {
                  fs.rmSync(path.join(userData, 'core-ota', 'boot.json'), { force: true });
                  app.relaunch();
                  app.exit(0);
                },
              ],
              [t.downloadPage, openDownloadPage],
              [t.quit, quit],
            ]);
          }
          logger.info(`downloading ${result.updateInfo.version}`);
          await autoUpdater.downloadUpdate();
          status.setText(t.installing);
          logger.info('installing');
          installing = true;
          app.releaseSingleInstanceLock();
          autoUpdater.quitAndInstall(true, true);
        } catch (updateError) {
          logger.error('update failed', updateError);
          return choose(t.failed, [
            [t.retryCheck, attempt],
            [t.downloadPage, openDownloadPage],
            [t.quit, quit],
          ]);
        }
      };

      // Squirrel.Mac reports install failures only through this event, after quitAndInstall.
      autoUpdater.on('error', (installError) => {
        if (!installing) return;
        installing = false;
        logger.error('install failed', installError);
        choose(t.failed, [
          [t.retryCheck, attempt],
          [t.downloadPage, openDownloadPage],
          [t.quit, quit],
        ]).catch(fallback);
      });

      return attempt();
    })
    .catch((rescueError) => {
      logger.error('rescue failed', rescueError);
      fallback(rescueError);
    });
}

module.exports = { configureUpdater, resolveChannel, resolveFeedUrl, runRescue };

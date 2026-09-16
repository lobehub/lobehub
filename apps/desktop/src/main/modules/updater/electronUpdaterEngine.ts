import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';

import { UPDATE_SERVER_URL } from './configs';
import type { UpdateEngine } from './engine';

autoUpdater.autoInstallOnAppQuit = false;

export const electronUpdaterEngine: UpdateEngine = {
  checkForUpdates: () => autoUpdater.checkForUpdates(),
  configure: (channel) => {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.autoDownload = false;
    autoUpdater.forceDevUpdateConfig = isDev || getDesktopEnv().FORCE_DEV_UPDATE_CONFIG;
    autoUpdater.allowPrerelease = channel !== 'stable';
    if (!autoUpdater.forceDevUpdateConfig) {
      const baseUrl = UPDATE_SERVER_URL?.replace(/\/(stable|nightly|canary|beta)\/?$/, '').replace(
        /\/$/,
        '',
      );
      autoUpdater.channel = channel;
      autoUpdater.setFeedURL(
        baseUrl
          ? { provider: 'generic', url: `${baseUrl}/${channel}` }
          : { owner: 'lobehub', provider: 'github', repo: 'lobehub' },
      );
    }
    // The channel setter mutates this flag. Windows/Linux retain rollback support.
    autoUpdater.allowDowngrade = true;
  },
  downloadUpdate: () => autoUpdater.downloadUpdate(),
  installOnQuit: () => {
    autoUpdater.autoInstallOnAppQuit = true;
  },
  isActive: () => autoUpdater.isUpdaterActive(),
  kind: 'electron-updater',
  on: (event, listener) => {
    autoUpdater.on(event, listener as (...args: any[]) => void);
  },
  quitAndInstall: () => autoUpdater.quitAndInstall(true, true),
};

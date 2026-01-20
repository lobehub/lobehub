import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

import { isDev, isWindows } from '@/const/env';
import { getDesktopEnv } from '@/env';
import {
  UPDATE_SERVER_URL,
  UPDATE_CHANNEL as channel,
  githubConfig,
  isStableChannel,
  updaterConfig,
} from '@/modules/updater/configs';
import { createLogger } from '@/utils/logger';

import type { App as AppCore } from '../App';

const FORCE_DEV_UPDATE_CONFIG = getDesktopEnv().FORCE_DEV_UPDATE_CONFIG;

const logger = createLogger('core:UpdaterManager');

export class UpdaterManager {
  private app: AppCore;
  private checking: boolean = false;
  private downloading: boolean = false;
  private updateAvailable: boolean = false;
  private isManualCheck: boolean = false;
  private usingFallbackProvider: boolean = false;

  constructor(app: AppCore) {
    this.app = app;

    log.transports.file.level = 'info';
    autoUpdater.logger = log;

    logger.debug(`[Updater] Log file should be at: ${log.transports.file.getFile().path}`);
  }

  get mainWindow() {
    return this.app.browserManager.getMainWindow();
  }

  public initialize = async () => {
    logger.debug('Initializing UpdaterManager');

    if (!updaterConfig.enableAppUpdate) {
      logger.info('App updates are disabled, skipping updater initialization');
      return;
    }

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;

    const useDevConfig = isDev || FORCE_DEV_UPDATE_CONFIG;
    if (useDevConfig) {
      autoUpdater.forceDevUpdateConfig = true;
      logger.info(
        `Using dev update config (isDev=${isDev}, FORCE_DEV_UPDATE_CONFIG=${FORCE_DEV_UPDATE_CONFIG})`,
      );
      logger.info('Dev mode: Using dev-app-update.yml for update configuration');
    } else {
      autoUpdater.allowPrerelease = channel !== 'stable';
      logger.info(`Production mode: channel=${channel}, allowPrerelease=${channel !== 'stable'}`);
      this.configureUpdateProvider();
    }

    this.registerEvents();

    if (updaterConfig.app.autoCheckUpdate) {
      setTimeout(() => this.checkForUpdates(), 60 * 1000);
      setInterval(() => this.checkForUpdates(), updaterConfig.app.checkUpdateInterval);
    }

    logger.debug(
      `Initialized with channel: ${autoUpdater.channel}, allowPrerelease: ${autoUpdater.allowPrerelease}`,
    );

    logger.info('UpdaterManager initialization completed');
  };

  /**
   * Check for updates
   * @param manual whether this is a manual check for updates
   */
  public checkForUpdates = async ({ manual = false }: { manual?: boolean } = {}) => {
    if (this.checking || this.downloading) return;

    this.checking = true;
    this.isManualCheck = manual;

    if (!isStableChannel) {
      autoUpdater.allowPrerelease = true;
    }

    logger.info(`${manual ? 'Manually checking' : 'Auto checking'} for updates...`);

    const inferredChannel =
      autoUpdater.channel ||
      (autoUpdater.currentVersion?.prerelease?.[0]
        ? String(autoUpdater.currentVersion.prerelease[0])
        : null);

    logger.info('[Updater Config] Channel:', autoUpdater.channel);
    logger.info('[Updater Config] inferredChannel:', inferredChannel);
    logger.info('[Updater Config] allowPrerelease:', autoUpdater.allowPrerelease);
    logger.info('[Updater Config] currentVersion:', autoUpdater.currentVersion?.version);
    logger.info('[Updater Config] allowDowngrade:', autoUpdater.allowDowngrade);
    logger.info('[Updater Config] autoDownload:', autoUpdater.autoDownload);
    logger.info('[Updater Config] forceDevUpdateConfig:', autoUpdater.forceDevUpdateConfig);
    logger.info('[Updater Config] Build channel from config:', channel);
    logger.info('[Updater Config] isStableChannel:', isStableChannel);
    logger.info('[Updater Config] UPDATE_SERVER_URL:', UPDATE_SERVER_URL || '(not set)');
    logger.info('[Updater Config] usingFallbackProvider:', this.usingFallbackProvider);
    logger.info('[Updater Config] GitHub config:', JSON.stringify(githubConfig));

    if (manual) {
      this.mainWindow.broadcast('manualUpdateCheckStart');
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      logger.error('Error checking for updates:', error.message);

      if (manual) {
        this.mainWindow.broadcast('updateError', (error as Error).message);
      }
    } finally {
      this.checking = false;
    }
  };

  /**
   * Download update
   * @param manual whether this is a manual download
   */
  public downloadUpdate = async (manual: boolean = false) => {
    if (this.downloading || !this.updateAvailable) return;

    this.downloading = true;
    logger.info(`${manual ? 'Manually downloading' : 'Auto downloading'} update...`);

    if (manual || this.isManualCheck) {
      this.mainWindow.broadcast('updateDownloadStart');
    }

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.downloading = false;
      logger.error('Error downloading update:', error);

      if (manual || this.isManualCheck) {
        this.mainWindow.broadcast('updateError', (error as Error).message);
      }
    }
  };

  /**
   * Install update immediately
   */
  public installNow = () => {
    logger.info('Installing update now...');

    this.app.isQuiting = true;

    logger.info('Closing all windows before update installation...');
    const { BrowserWindow, app } = require('electron');
    if (!isWindows) {
      const allWindows = BrowserWindow.getAllWindows();
      allWindows.forEach((window) => {
        if (!window.isDestroyed()) {
          window.close();
        }
      });
    }

    logger.info('Releasing single instance lock...');
    app.releaseSingleInstanceLock();

    setTimeout(() => {
      logger.info('Calling autoUpdater.quitAndInstall...');
      autoUpdater.quitAndInstall(true, true);
    }, 100);
  };

  /**
   * Install update on next launch
   */
  public installLater = () => {
    logger.info('Update will be installed on next restart');

    autoUpdater.autoInstallOnAppQuit = true;
    this.mainWindow.broadcast('updateWillInstallLater');
  };

  /**
   * Test mode: Simulate update available
   * Only for use in development environment
   */
  public simulateUpdateAvailable = () => {
    if (!isDev) return;

    logger.info('Simulating update available...');

    const mainWindow = this.mainWindow;
    const mockUpdateInfo = {
      releaseDate: new Date().toISOString(),
      releaseNotes: ` #### Version 1.0.0 Release Notes
- Added some great new features
- Fixed bugs affecting usability
- Optimized overall application performance
- Updated dependency libraries
`,
      version: '1.0.0',
    };

    this.updateAvailable = true;

    if (this.isManualCheck) {
      mainWindow.broadcast('manualUpdateAvailable', mockUpdateInfo);
    } else {
      this.simulateDownloadProgress();
    }
  };

  /**
   * Test mode: Simulate update downloaded
   * Only for use in development environment
   */
  public simulateUpdateDownloaded = () => {
    if (!isDev) return;

    logger.info('Simulating update downloaded...');

    const mainWindow = this.app.browserManager.getMainWindow();
    if (mainWindow) {
      const mockUpdateInfo = {
        releaseDate: new Date().toISOString(),
        releaseNotes: ` #### Version 1.0.0 Release Notes
- Added some great new features
- Fixed bugs affecting usability
- Optimized overall application performance
- Updated dependency libraries
`,
        version: '1.0.0',
      };

      this.downloading = false;
      mainWindow.broadcast('updateDownloaded', mockUpdateInfo);
    }
  };

  /**
   * Test mode: Simulate update download progress
   * Only for use in development environment
   */
  public simulateDownloadProgress = () => {
    if (!isDev) return;

    logger.info('Simulating download progress...');

    const mainWindow = this.app.browserManager.getMainWindow();

    this.downloading = true;

    if (this.isManualCheck) {
      mainWindow.broadcast('updateDownloadStart');
    }

    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;

      if (progress <= 100 && this.isManualCheck) {
        mainWindow.broadcast('updateDownloadProgress', {
          bytesPerSecond: 1024 * 1024,
          percent: progress,
          total: 1024 * 1024 * 100,
          transferred: 1024 * 1024 * progress,
        });
      }

      if (progress >= 100) {
        clearInterval(interval);
        this.simulateUpdateDownloaded();
      }
    }, 300);
  };

  /**
   * Configure update provider based on channel
   * - Stable channel + UPDATE_SERVER_URL: Use generic HTTP provider (S3) as primary, channel=stable
   * - Other channels (beta/nightly) or no S3: Use GitHub provider, channel unset (defaults to latest)
   *
   * Important: S3 has stable-mac.yml, GitHub has latest-mac.yml
   */
  private configureUpdateProvider() {
    if (isStableChannel && UPDATE_SERVER_URL && !this.usingFallbackProvider) {
      autoUpdater.channel = 'stable';
      logger.info(`Configuring generic provider for stable channel (primary)`);
      logger.info(`Update server URL: ${UPDATE_SERVER_URL}`);
      logger.info(`Channel set to: stable (will look for stable-mac.yml)`);

      autoUpdater.setFeedURL({
        provider: 'generic',
        url: UPDATE_SERVER_URL,
      });
    } else {
      const reason = this.usingFallbackProvider ? '(fallback from S3)' : '';
      logger.info(`Configuring GitHub provider for ${channel} channel ${reason}`);
      if (autoUpdater.channel !== null) {
        autoUpdater.channel = null;
      }
      logger.info('Channel left unset (defaults to latest-mac.yml for GitHub)');

      const needPrerelease = channel !== 'stable';

      autoUpdater.setFeedURL({
        owner: githubConfig.owner,
        provider: 'github',
        repo: githubConfig.repo,
      });

      autoUpdater.allowPrerelease = needPrerelease;

      logger.info(
        `GitHub update URL configured: ${githubConfig.owner}/${githubConfig.repo}, allowPrerelease=${needPrerelease}`,
      );
    }
  }

  /**
   * Switch to fallback provider (GitHub) and retry update check
   * Called when primary provider (S3) fails
   */
  private switchToFallbackAndRetry = async () => {
    if (!isStableChannel || !UPDATE_SERVER_URL || this.usingFallbackProvider) {
      return false;
    }

    logger.info('Primary update server (S3) failed, switching to GitHub fallback...');
    this.usingFallbackProvider = true;
    this.configureUpdateProvider();

    try {
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      logger.error('Fallback provider (GitHub) also failed:', error);
      return false;
    }
  };

  /**
   * Reset to primary provider for next update check
   */
  private resetToPrimaryProvider = () => {
    if (this.usingFallbackProvider) {
      logger.info('Resetting to primary update provider (S3)');
      this.usingFallbackProvider = false;
      this.configureUpdateProvider();
    }
  };

  private registerEvents() {
    logger.debug('Registering updater events');

    autoUpdater.on('checking-for-update', () => {
      logger.info('[Updater] Checking for update...');
      logger.info('[Updater] Current channel:', autoUpdater.channel);
      logger.info('[Updater] Current allowPrerelease:', autoUpdater.allowPrerelease);
    });

    autoUpdater.on('update-available', (info) => {
      logger.info(`Update available: ${info.version}`);
      this.updateAvailable = true;

      this.resetToPrimaryProvider();

      if (this.isManualCheck) {
        this.mainWindow.broadcast('manualUpdateAvailable', info);
      } else {
        logger.info('Auto check found update, starting download automatically...');
        this.downloadUpdate();
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      logger.info(`Update not available. Current: ${info.version}`);

      this.resetToPrimaryProvider();

      if (this.isManualCheck) {
        this.mainWindow.broadcast('manualUpdateNotAvailable', info);
      }
    });

    autoUpdater.on('error', async (err) => {
      logger.error('Error in auto-updater:', err);
      logger.error('[Updater Error Context] Channel:', autoUpdater.channel);
      logger.error('[Updater Error Context] allowPrerelease:', autoUpdater.allowPrerelease);
      logger.error('[Updater Error Context] Build channel from config:', channel);
      logger.error('[Updater Error Context] isStableChannel:', isStableChannel);
      logger.error('[Updater Error Context] UPDATE_SERVER_URL:', UPDATE_SERVER_URL || '(not set)');
      logger.error('[Updater Error Context] usingFallbackProvider:', this.usingFallbackProvider);
      logger.error('[Updater Error Context] GitHub config:', JSON.stringify(githubConfig));

      if (!this.usingFallbackProvider && isStableChannel && UPDATE_SERVER_URL) {
        logger.info('Attempting fallback to GitHub provider...');
        const fallbackSucceeded = await this.switchToFallbackAndRetry();
        if (fallbackSucceeded) {
          return;
        }
      }

      if (this.isManualCheck) {
        this.mainWindow.broadcast('updateError', err.message);
      }
    });

    autoUpdater.on('download-progress', (progressObj) => {
      logger.debug(
        `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`,
      );
      if (this.isManualCheck) {
        this.mainWindow.broadcast('updateDownloadProgress', progressObj);
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`Update downloaded: ${info.version}`);
      this.downloading = false;
      this.mainWindow.broadcast('updateDownloaded', info);
    });

    logger.debug('Updater events registered');
  }
}

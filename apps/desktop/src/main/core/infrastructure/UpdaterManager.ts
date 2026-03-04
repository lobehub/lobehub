import type { UpdateChannel, UpdateInfo } from '@lobechat/electron-client-ipc';
import { app as electronApp } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

import { isDev, isWindows } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { UPDATE_CHANNEL, UPDATE_SERVER_URL, updaterConfig } from '@/modules/updater/configs';
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
  private currentChannel: UpdateChannel = UPDATE_CHANNEL;
  /** Incremented on each channel switch to invalidate in-flight checks */
  private checkGeneration: number = 0;
  /** Generation at the start of the current active check */
  private activeGeneration: number = 0;
  /** Whether a recheck is needed after the current check completes */
  private pendingRecheck: boolean = false;

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

    // Read persisted channel from store (defaults to build-time UPDATE_CHANNEL)
    this.currentChannel = this.app.storeManager.get('updateChannel') ?? UPDATE_CHANNEL;

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
      autoUpdater.allowPrerelease = this.currentChannel !== 'stable';
      logger.info(
        `Production mode: channel=${this.currentChannel}, allowPrerelease=${this.currentChannel !== 'stable'}`,
      );
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
   * Switch to a different update channel at runtime
   */
  public switchChannel = (channel: UpdateChannel) => {
    logger.info(`Switching update channel: ${this.currentChannel} -> ${channel}`);

    const isDowngrade =
      (this.currentChannel === 'canary' && channel !== 'canary') ||
      (this.currentChannel === 'nightly' && channel === 'stable');

    this.currentChannel = channel;
    autoUpdater.allowDowngrade = isDowngrade;
    logger.info(`allowDowngrade=${isDowngrade}`);

    autoUpdater.allowPrerelease = channel !== 'stable';
    this.configureUpdateProvider();

    this.mainWindow.broadcast('updateChannelChanged', channel);

    // Invalidate any in-flight check and schedule a recheck
    this.checkGeneration++;
    if (this.checking) {
      this.pendingRecheck = true;
    } else {
      this.checkForUpdates();
    }
  };

  /**
   * Check for updates
   * @param manual whether this is a manual check for updates
   */
  public checkForUpdates = async ({ manual = false }: { manual?: boolean } = {}) => {
    if (this.checking || this.downloading) return;

    this.checking = true;
    this.isManualCheck = manual;
    this.activeGeneration = this.checkGeneration;

    autoUpdater.allowPrerelease = this.currentChannel !== 'stable';

    logger.info(
      `${manual ? 'Manually checking' : 'Auto checking'} for updates... (gen=${this.activeGeneration})`,
    );

    logger.info('[Updater Config] Channel:', autoUpdater.channel);
    logger.info('[Updater Config] currentChannel:', this.currentChannel);
    logger.info('[Updater Config] allowPrerelease:', autoUpdater.allowPrerelease);
    logger.info('[Updater Config] currentVersion:', autoUpdater.currentVersion?.version);
    logger.info('[Updater Config] allowDowngrade:', autoUpdater.allowDowngrade);
    logger.info('[Updater Config] autoDownload:', autoUpdater.autoDownload);
    logger.info('[Updater Config] forceDevUpdateConfig:', autoUpdater.forceDevUpdateConfig);
    logger.info('[Updater Config] Build channel from config:', UPDATE_CHANNEL);
    logger.info('[Updater Config] UPDATE_SERVER_URL:', UPDATE_SERVER_URL || '(not set)');

    if (manual) {
      this.mainWindow.broadcast('manualUpdateCheckStart');
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (this.isStaleCheck()) return;

      const message = error instanceof Error ? error.message : String(error);

      if (this.isMissingUpdateManifestError(error)) {
        logger.warn('[Updater] Update manifest not ready yet, treating as no update:', message);
        if (manual) {
          this.mainWindow.broadcast('manualUpdateNotAvailable', this.getCurrentUpdateInfo());
        }
        return;
      }

      logger.error('Error checking for updates:', message);

      if (manual) {
        this.mainWindow.broadcast('updateError', message);
      }
    } finally {
      this.checking = false;
      if (this.pendingRecheck) {
        this.pendingRecheck = false;
        this.checkForUpdates();
      }
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
      allWindows.forEach((window: any) => {
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
   * Strip trailing channel path from URL so we can re-append the correct channel.
   * Handles both base URL (https://cdn.example.com) and legacy URL with channel (https://cdn.example.com/stable)
   */
  private getBaseUpdateUrl(): string | undefined {
    if (!UPDATE_SERVER_URL) return undefined;
    return UPDATE_SERVER_URL.replace(/\/(stable|nightly|canary|beta)\/?$/, '');
  }

  /**
   * Configure update provider — all channels use generic HTTP provider (S3)
   * URL format: {base}/{channel}/
   * electron-updater looks for {channel}-mac.yml
   */
  private configureUpdateProvider() {
    const baseUrl = this.getBaseUpdateUrl();
    if (baseUrl) {
      const feedUrl = `${baseUrl}/${this.currentChannel}`;
      autoUpdater.channel = this.currentChannel;

      logger.info(`Configuring generic provider for ${this.currentChannel} channel`);
      logger.info(`Update server URL: ${feedUrl}`);
      logger.info(
        `Channel set to: ${this.currentChannel} (will look for ${this.currentChannel}-mac.yml)`,
      );

      autoUpdater.setFeedURL({
        provider: 'generic',
        url: feedUrl,
      });
    } else {
      // Fallback to GitHub when no S3 URL configured (local dev)
      logger.info(
        `No UPDATE_SERVER_URL configured, falling back to GitHub provider for ${this.currentChannel} channel`,
      );

      autoUpdater.setFeedURL({
        owner: 'lobehub',
        provider: 'github',
        repo: 'lobehub',
      });

      autoUpdater.allowPrerelease = this.currentChannel !== 'stable';
    }
  }

  private registerEvents() {
    logger.debug('Registering updater events');

    autoUpdater.on('checking-for-update', () => {
      logger.info('[Updater] Checking for update...');
      logger.info('[Updater] Current channel:', autoUpdater.channel);
      logger.info('[Updater] Current allowPrerelease:', autoUpdater.allowPrerelease);
    });

    autoUpdater.on('update-available', (info) => {
      logger.info(
        `Update available: ${info.version} (activeGen=${this.activeGeneration}, currentGen=${this.checkGeneration})`,
      );

      if (this.isStaleCheck()) return;

      this.updateAvailable = true;

      if (this.isManualCheck) {
        this.mainWindow.broadcast('manualUpdateAvailable', info);
      } else {
        logger.info('Auto check found update, starting download automatically...');
        this.downloadUpdate();
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      logger.info(`Update not available. Current: ${info.version}`);

      if (this.isManualCheck) {
        this.mainWindow.broadcast('manualUpdateNotAvailable', info);
      }
    });

    autoUpdater.on('error', async (err) => {
      const message = err instanceof Error ? err.message : String(err);

      if (this.isMissingUpdateManifestError(err)) {
        logger.warn('[Updater] Update manifest not ready yet, skipping error handling:', message);
        if (this.isManualCheck) {
          this.mainWindow.broadcast('manualUpdateNotAvailable', this.getCurrentUpdateInfo());
        }
        return;
      }

      logger.error('Error in auto-updater:', err);
      logger.error('[Updater Error Context] Channel:', autoUpdater.channel);
      logger.error('[Updater Error Context] currentChannel:', this.currentChannel);
      logger.error('[Updater Error Context] allowPrerelease:', autoUpdater.allowPrerelease);
      logger.error('[Updater Error Context] UPDATE_SERVER_URL:', UPDATE_SERVER_URL || '(not set)');

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

  /** Check if the current active check has been superseded by a channel switch */
  private isStaleCheck(): boolean {
    if (this.activeGeneration !== this.checkGeneration) {
      logger.info(
        `Discarding stale check result (activeGen=${this.activeGeneration}, currentGen=${this.checkGeneration})`,
      );
      return true;
    }
    return false;
  }

  private isMissingUpdateManifestError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (!message) return false;

    if (!/cannot find/i.test(message)) return false;
    if (!/\b404\b/.test(message)) return false;

    const manifestMatch = message.match(/\b(?:latest|stable|nightly|canary)(?:-[\da-z]+)?\.yml\b/i);
    return Boolean(manifestMatch);
  }

  private getCurrentUpdateInfo(): UpdateInfo {
    const version = autoUpdater.currentVersion?.version || electronApp.getVersion();
    return {
      releaseDate: new Date().toISOString(),
      version,
    };
  }
}

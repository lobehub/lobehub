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

// Allow forcing dev update config via env (for testing updates in packaged app)
const FORCE_DEV_UPDATE_CONFIG = getDesktopEnv().FORCE_DEV_UPDATE_CONFIG;

// Create logger
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

    // 设置日志
    log.transports.file.level = 'info';
    autoUpdater.logger = log;

    logger.debug(`[Updater] Log file should be at: ${log.transports.file.getFile().path}`); // 打印路径
  }

  get mainWindow() {
    return this.app.browserManager.getMainWindow();
  }

  public initialize = async () => {
    logger.debug('Initializing UpdaterManager');
    // If updates are disabled and in production environment, don't initialize updates
    if (!updaterConfig.enableAppUpdate && !isDev) {
      logger.info('App updates are disabled, skipping updater initialization');
      return;
    }

    // Configure autoUpdater
    autoUpdater.autoDownload = false; // Set to false, we'll control downloads manually
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;

    // Enable test mode in development environment or when forced via env
    // IMPORTANT: This must be set BEFORE channel configuration so that
    // dev-app-update.yml takes precedence over programmatic configuration
    const useDevConfig = isDev || FORCE_DEV_UPDATE_CONFIG;
    if (useDevConfig) {
      // In dev mode, use dev-app-update.yml for all configuration including channel
      // Don't set channel here - let dev-app-update.yml control it (defaults to "latest")
      autoUpdater.forceDevUpdateConfig = true;
      logger.info(
        `Using dev update config (isDev=${isDev}, FORCE_DEV_UPDATE_CONFIG=${FORCE_DEV_UPDATE_CONFIG})`,
      );
      logger.info('Dev mode: Using dev-app-update.yml for update configuration');
    } else {
      // Only configure channel and update provider programmatically in production
      // Note: channel is configured in configureUpdateProvider based on provider type
      autoUpdater.allowPrerelease = channel !== 'stable';
      logger.info(`Production mode: channel=${channel}, allowPrerelease=${channel !== 'stable'}`);
      this.configureUpdateProvider();
    }

    // Register events
    this.registerEvents();

    // If auto-check for updates is configured, set up periodic checks
    if (updaterConfig.app.autoCheckUpdate) {
      // Delay update check by 1 minute after startup to avoid network instability
      setTimeout(() => this.checkForUpdates(), 60 * 1000);

      // Set up periodic checks
      setInterval(() => this.checkForUpdates(), updaterConfig.app.checkUpdateInterval);
    }

    // Log the channel and allowPrerelease values
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

    // Ensure allowPrerelease is correctly set before each check
    // This guards against any internal state reset by electron-updater
    if (!isStableChannel) {
      autoUpdater.allowPrerelease = true;
    }

    logger.info(`${manual ? 'Manually checking' : 'Auto checking'} for updates...`);

    // If manual check, notify renderer process about check start
    if (manual) {
      this.mainWindow.broadcast('manualUpdateCheckStart');
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      logger.error('Error checking for updates:', error.message);

      // If manual check, notify renderer process about check error
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

    // If manual download or manual check, notify renderer process about download start
    if (manual || this.isManualCheck) {
      this.mainWindow.broadcast('updateDownloadStart');
    }

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.downloading = false;
      logger.error('Error downloading update:', error);

      // If manual download or manual check, notify renderer process about download error
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

    // Mark application for exit
    this.app.isQuiting = true;

    // Close all windows first to ensure clean exit
    logger.info('Closing all windows before update installation...');
    const { BrowserWindow, app } = require('electron');
    // do not close windows and quit first
    // on Windows, window-all-closed -> app.quit()` can terminate the process before the timer fires
    if (!isWindows) {
      const allWindows = BrowserWindow.getAllWindows();
      allWindows.forEach((window) => {
        if (!window.isDestroyed()) {
          window.close();
        }
      });
    }

    // Release single instance lock before quitting
    // This ensures the new instance can acquire the lock
    logger.info('Releasing single instance lock...');
    app.releaseSingleInstanceLock();

    // Small delay to ensure windows are closed and lock is released
    setTimeout(() => {
      // quitAndInstall parameters:
      // - isSilent: true (don't show installation UI)
      // - isForceRunAfter: true (force start app after installation)
      logger.info('Calling autoUpdater.quitAndInstall...');
      autoUpdater.quitAndInstall(true, true);
    }, 100);
  };

  /**
   * Install update on next launch
   */
  public installLater = () => {
    logger.info('Update will be installed on next restart');

    // Mark for installation on next launch, but don't exit application
    autoUpdater.autoInstallOnAppQuit = true;

    // Notify renderer process that update will be installed on next launch
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
    // Simulate a new version update
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

    // Set update available state
    this.updateAvailable = true;

    // Notify renderer process
    if (this.isManualCheck) {
      mainWindow.broadcast('manualUpdateAvailable', mockUpdateInfo);
    } else {
      // In auto-check mode, directly simulate download
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
      // Simulate a new version update
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

      // Set download state
      this.downloading = false;

      // Notify renderer process
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

    // Set download state
    this.downloading = true;

    // Only broadcast download start event if manual check
    if (this.isManualCheck) {
      mainWindow.broadcast('updateDownloadStart');
    }

    // Simulate progress updates
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;

      if (
        progress <= 100 && // Only broadcast download progress if manual check
        this.isManualCheck
      ) {
        mainWindow.broadcast('updateDownloadProgress', {
          bytesPerSecond: 1024 * 1024,
          percent: progress, // 1MB/s
          total: 1024 * 1024 * 100, // 100MB
          transferred: 1024 * 1024 * progress, // Progress * 1MB
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
   * - Other channels (beta/nightly) or no S3: Use GitHub provider, channel=latest
   *
   * Important: S3 has stable-mac.yml, GitHub has latest-mac.yml
   */
  private configureUpdateProvider() {
    if (isStableChannel && UPDATE_SERVER_URL && !this.usingFallbackProvider) {
      // Stable channel uses custom update server (generic HTTP) as primary
      // S3 has stable-mac.yml, so we set channel to 'stable'
      autoUpdater.channel = 'stable';
      logger.info(`Configuring generic provider for stable channel (primary)`);
      logger.info(`Update server URL: ${UPDATE_SERVER_URL}`);
      logger.info(`Channel set to: stable (will look for stable-mac.yml)`);

      autoUpdater.setFeedURL({
        provider: 'generic',
        url: UPDATE_SERVER_URL,
      });
    } else {
      // Beta/nightly channels use GitHub, or fallback to GitHub if UPDATE_SERVER_URL not configured
      // GitHub releases have latest-mac.yml, so we use default channel (latest)
      autoUpdater.channel = 'latest';
      const reason = this.usingFallbackProvider ? '(fallback from S3)' : '';
      logger.info(`Configuring GitHub provider for ${channel} channel ${reason}`);
      logger.info(`Channel set to: latest (will look for latest-mac.yml)`);

      // For beta/nightly channels, we need prerelease versions
      const needPrerelease = channel !== 'stable';

      autoUpdater.setFeedURL({
        owner: githubConfig.owner,
        provider: 'github',
        repo: githubConfig.repo,
      });

      // Ensure allowPrerelease is set correctly after setFeedURL
      // setFeedURL may reset some internal states
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
    // Only fallback if we're on stable channel with S3 configured and haven't already fallen back
    if (!isStableChannel || !UPDATE_SERVER_URL || this.usingFallbackProvider) {
      return false;
    }

    logger.info('Primary update server (S3) failed, switching to GitHub fallback...');
    this.usingFallbackProvider = true;
    this.configureUpdateProvider();

    // Retry update check with fallback provider
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
    });

    autoUpdater.on('update-available', (info) => {
      logger.info(`Update available: ${info.version}`);
      this.updateAvailable = true;

      // Reset to primary provider for next check cycle
      this.resetToPrimaryProvider();

      if (this.isManualCheck) {
        this.mainWindow.broadcast('manualUpdateAvailable', info);
      } else {
        // If it's an automatic check, start downloading automatically
        logger.info('Auto check found update, starting download automatically...');
        this.downloadUpdate();
      }
    });

    autoUpdater.on('update-not-available', (info) => {
      logger.info(`Update not available. Current: ${info.version}`);

      // Reset to primary provider for next check cycle
      this.resetToPrimaryProvider();

      if (this.isManualCheck) {
        this.mainWindow.broadcast('manualUpdateNotAvailable', info);
      }
    });

    autoUpdater.on('error', async (err) => {
      logger.error('Error in auto-updater:', err);

      // Try fallback to GitHub if S3 failed
      if (!this.usingFallbackProvider && isStableChannel && UPDATE_SERVER_URL) {
        logger.info('Attempting fallback to GitHub provider...');
        const fallbackSucceeded = await this.switchToFallbackAndRetry();
        if (fallbackSucceeded) {
          return; // Fallback initiated, don't report error yet
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
      // Always notify about downloaded update
      this.mainWindow.broadcast('updateDownloaded', info);
    });

    logger.debug('Updater events registered');
  }
}

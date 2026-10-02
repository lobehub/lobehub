import type {
  ProgressInfo,
  UpdateChannel,
  UpdateInfo,
  UpdaterStage,
  UpdaterState,
} from '@lobechat/electron-client-ipc';
import { app as electronApp } from 'electron';
import semver from 'semver';

import { isDev, isWindows } from '@/const/env';
import { UPDATE_CHANNEL, UPDATE_SERVER_URL, updaterConfig } from '@/modules/updater/configs';
import { createUpdateEngine, type UpdateEngine } from '@/modules/updater/engine';
import { extractRestoreRoute } from '@/modules/updater/utils';
import { createLogger } from '@/utils/logger';

import type { App as AppCore } from '../App';

const logger = createLogger('core:UpdaterManager');

export class UpdaterManager {
  private app: AppCore;
  private checking: boolean = false;
  private downloading: boolean = false;
  private updateAvailable: boolean = false;
  private currentChannel: UpdateChannel = UPDATE_CHANNEL;
  private engine?: UpdateEngine;
  /** Incremented on each channel switch to invalidate in-flight checks */
  private checkGeneration: number = 0;
  /** Generation at the start of the current active check */
  private activeGeneration: number = 0;
  /** Whether a recheck is needed after the current check completes */
  private pendingRecheck: boolean = false;
  /**
   * Version the user acknowledged with "install later" in the current process.
   * While set, equal-version update-available/downloaded events are processed
   * for menu state but never re-broadcast to the renderer, so the prompt does
   * not reappear within the session. Cleared when a strictly newer version
   * arrives (or on channel switch).
   */
  private installLaterVersion: string | null = null;

  private stage: UpdaterStage = 'idle';
  private latestUpdateInfo: UpdateInfo | null = null;
  private latestProgress: ProgressInfo | null = null;
  private latestError: string | null = null;

  constructor(app: AppCore) {
    this.app = app;
  }

  get mainWindow() {
    return this.app.browserManager.getMainWindow();
  }

  public getUpdaterState(): UpdaterState {
    const state: UpdaterState = { stage: this.stage };
    if (this.latestProgress) state.progress = this.latestProgress;
    if (this.latestUpdateInfo) state.updateInfo = this.latestUpdateInfo;
    if (this.latestError) state.errorMessage = this.latestError;
    return state;
  }

  private setStage(
    stage: UpdaterStage,
    opts?: {
      error?: string;
      progress?: ProgressInfo;
      rebuildMenu?: boolean;
      updateInfo?: UpdateInfo;
    },
  ) {
    this.stage = stage;
    if (opts?.updateInfo !== undefined) this.latestUpdateInfo = opts.updateInfo;
    if (opts?.progress !== undefined) this.latestProgress = opts.progress;
    if (opts?.error !== undefined) this.latestError = opts.error;

    // Clear irrelevant fields on stage transitions
    if (stage === 'idle' || stage === 'checking') {
      this.latestProgress = null;
      this.latestError = null;
    }
    if (stage !== 'error') {
      this.latestError = null;
    }

    this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());

    if (opts?.rebuildMenu !== false) {
      this.app.menuManager.rebuildAppMenu();
    }
  }

  public initialize = async () => {
    logger.debug('Initializing UpdaterManager');

    if (!updaterConfig.enableAppUpdate) {
      logger.info('App updates are disabled, skipping updater initialization');
      return;
    }

    // Read persisted channel from store (defaults to build-time UPDATE_CHANNEL)
    this.currentChannel = this.app.storeManager.get('updateChannel') ?? UPDATE_CHANNEL;

    try {
      this.engine = await createUpdateEngine(this.currentChannel);
      this.engine.configure(this.currentChannel);
    } catch (error) {
      logger.error('Failed to initialize updater:', error);
      this.setStage('error', { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    this.registerEvents();

    if (updaterConfig.app.autoCheckUpdate) {
      setTimeout(() => this.checkForUpdates(), 60 * 1000);
      setInterval(() => this.checkForUpdates(), updaterConfig.app.checkUpdateInterval);
    }

    logger.info('UpdaterManager initialization completed');
  };

  /**
   * Switch to a different update channel at runtime
   */
  public switchChannel = (channel: UpdateChannel) => {
    logger.info(`Switching update channel: ${this.currentChannel} -> ${channel}`);

    this.currentChannel = channel;
    this.installLaterVersion = null;
    this.updateAvailable = false;
    this.latestUpdateInfo = null;

    this.mainWindow.broadcast('updateChannelChanged', channel);

    // Invalidate any in-flight check and schedule a recheck
    this.checkGeneration++;
    if (this.checking || this.downloading) {
      this.pendingRecheck = true;
    } else {
      this.checkForUpdates();
    }
  };

  /**
   * Check for updates
   */
  public checkForUpdates = async ({ manual = false }: { manual?: boolean } = {}) => {
    if (manual) void this.app.coreUpdateManager.checkForUpdates({ manual: true });
    if (!this.engine || this.checking || this.downloading) return;

    this.checking = true;
    this.activeGeneration = this.checkGeneration;

    logger.info(
      `${manual ? 'Manually checking' : 'Auto checking'} for updates... (gen=${this.activeGeneration})`,
    );

    this.setStage('checking');

    try {
      this.engine.configure(this.currentChannel);
      await this.engine.checkForUpdates();
    } catch (error) {
      if (this.isStaleCheck()) return;

      const message = error instanceof Error ? error.message : String(error);

      if (this.isMissingUpdateManifestError(error)) {
        logger.warn('[Updater] Update manifest not ready yet, treating as no update:', message);
        this.setStage('latest');
        setTimeout(() => {
          if (this.stage === 'latest') this.setStage('idle');
        }, 5000);
        return;
      }

      logger.error('Error checking for updates:', message);
      this.setStage('error', { error: message });
      setTimeout(() => {
        if (this.stage === 'error') this.setStage('idle');
      }, 3000);
    } finally {
      this.checking = false;
      if (this.pendingRecheck) {
        this.pendingRecheck = false;
        this.checkForUpdates();
      }
    }
  };

  /**
   * Check for updates because someone explicitly asked to update this app from
   * another device. An earlier local "install later" would keep the found
   * update from downloading, so the explicit request overrides it.
   */
  public checkForUpdatesOnRequest = () => {
    if (this.installLaterVersion) {
      logger.info(
        `Remote update requested; clearing install-later for v${this.installLaterVersion}`,
      );
      this.installLaterVersion = null;
    }

    void this.checkForUpdates({ manual: true });
  };

  /**
   * Download update
   */
  public downloadUpdate = async () => {
    if (!this.engine || this.downloading || !this.updateAvailable) return;

    this.downloading = true;
    logger.info('Downloading update...');

    this.setStage('downloading');

    try {
      await this.engine.downloadUpdate();
    } catch (error) {
      this.downloading = false;
      logger.error('Error downloading update:', error);
      this.setStage('error', { error: (error as Error).message });
      setTimeout(() => {
        if (this.stage === 'error') this.setStage('idle');
      }, 3000);
    }
  };

  captureRestoreRoute = () => {
    try {
      const url = this.mainWindow.webContents?.getURL();
      if (!url) return;

      const route = extractRestoreRoute(url);
      if (!route) return;

      this.app.storeManager.set('pendingRestoreRoute', route);
      logger.info(`Captured route for restore after update restart: ${route}`);
    } catch (error) {
      logger.warn('Failed to capture route for restore after update restart:', error);
    }
  };

  /**
   * Install update immediately
   */
  public installNow = () => {
    if (!this.engine || !this.updateAvailable) return;
    logger.info('Installing update now...');

    this.captureRestoreRoute();

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
      logger.info(`Calling ${this.engine?.kind} quitAndInstall...`);
      this.engine?.quitAndInstall();
    }, 100);
  };

  /**
   * Install update on next launch
   */
  public installLater = () => {
    logger.info('Update will be installed on next restart');

    if (!this.engine) return;
    this.engine.installOnQuit();
    if (this.latestUpdateInfo?.version) {
      this.installLaterVersion = this.latestUpdateInfo.version;
      logger.info(`Suppressing further prompts for version ${this.installLaterVersion}`);
    }
    this.mainWindow.broadcast('updateWillInstallLater');
  };

  /**
   * Test mode: Simulate update available
   */
  public simulateUpdateAvailable = () => {
    if (!isDev) return;

    logger.info('Simulating update available...');

    const mockUpdateInfo: UpdateInfo = {
      kind: 'app',
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
    this.setStage('checking');

    setTimeout(() => {
      this.setStage('downloading', { updateInfo: mockUpdateInfo });
      this.simulateDownloadProgress();
    }, 1000);
  };

  /**
   * Test mode: Simulate update downloaded
   */
  public simulateUpdateDownloaded = () => {
    if (!isDev) return;

    logger.info('Simulating update downloaded...');

    const mockUpdateInfo: UpdateInfo = {
      kind: 'app',
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
    this.setStage('downloaded', { updateInfo: mockUpdateInfo });
    this.mainWindow.broadcast('updateReady', mockUpdateInfo);
  };

  /**
   * Test mode: Simulate update download progress
   */
  public simulateDownloadProgress = () => {
    if (!isDev) return;

    logger.info('Simulating download progress...');

    this.downloading = true;

    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;

      if (progress <= 100) {
        const progressInfo: ProgressInfo = {
          bytesPerSecond: 1024 * 1024,
          percent: progress,
          total: 1024 * 1024 * 100,
          transferred: 1024 * 1024 * progress,
        };
        this.latestProgress = progressInfo;
        this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());
        this.mainWindow.broadcast('updateDownloadProgress', progressInfo);
      }

      if (progress >= 100) {
        clearInterval(interval);
        this.simulateUpdateDownloaded();
      }
    }, 300);
  };

  private registerEvents() {
    if (this.engine) this.bindEngine(this.engine);
  }

  private bindEngine(engine: UpdateEngine) {
    engine.on('checking-for-update', () => {
      logger.info('[Updater] Checking for update...');
      logger.info('[Updater] Current channel:', this.currentChannel);
    });

    engine.on('update-available', (info) => {
      logger.info(
        `Update available: ${info.version} (activeGen=${this.activeGeneration}, currentGen=${this.checkGeneration})`,
      );

      if (this.isStaleCheck()) return;

      this.maybeClearInstallLaterGuard(info.version);

      this.updateAvailable = true;

      if (this.installLaterVersion) {
        logger.info(
          `Skipping auto-download — install-later acknowledged for v${this.installLaterVersion}, incoming v${info.version}`,
        );
        // Finish the check with the cached update still installable, without reopening its prompt.
        this.setStage('downloaded');
        return;
      }

      // Always auto-download
      logger.info('Update found, starting download automatically...');
      this.setStage('downloading', { updateInfo: { ...info, kind: 'app' } });
      this.downloadUpdate();
    });

    engine.on('update-not-available', (info) => {
      if (this.isStaleCheck()) return;
      logger.info(`Update not available. Current: ${info.version}`);

      this.setStage('latest');
      setTimeout(() => {
        if (this.stage === 'latest') this.setStage('idle');
      }, 5000);
    });

    engine.on('error', async (err) => {
      this.downloading = false;
      if (this.isStaleCheck()) return;
      const message = err instanceof Error ? err.message : String(err);

      if (this.isMissingUpdateManifestError(err)) {
        logger.warn('[Updater] Update manifest not ready yet, skipping error handling:', message);
        this.setStage('latest');
        setTimeout(() => {
          if (this.stage === 'latest') this.setStage('idle');
        }, 5000);
        return;
      }

      logger.error('Error in auto-updater:', err);
      logger.error('[Updater Error Context] currentChannel:', this.currentChannel);
      logger.error('[Updater Error Context] UPDATE_SERVER_URL:', UPDATE_SERVER_URL || '(not set)');

      this.mainWindow.broadcast('updateError', err.message);
      this.setStage('error', { error: message });
      setTimeout(() => {
        if (this.stage === 'error') this.setStage('idle');
      }, 3000);
    });

    engine.on('download-progress', (progressObj) => {
      if (this.isStaleCheck()) return;
      logger.debug(
        `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`,
      );
      this.latestProgress = progressObj;
      // Broadcast state without menu rebuild (too frequent)
      this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());
      this.mainWindow.broadcast('updateDownloadProgress', progressObj);
    });

    engine.on('update-downloaded', (info) => {
      logger.info(`Update downloaded: ${info.version}`);
      this.downloading = false;
      if (this.isStaleCheck()) return;

      this.maybeClearInstallLaterGuard(info.version);

      const updateInfo = { ...info, kind: 'app' } satisfies UpdateInfo;
      this.setStage('downloaded', { updateInfo });

      if (this.installLaterVersion) {
        logger.info(
          `Not broadcasting updateReady — install-later acknowledged for v${this.installLaterVersion}, incoming v${info.version}`,
        );
        return;
      }

      this.mainWindow.broadcast('updateReady', updateInfo);
    });
  }

  /**
   * Clear the install-later guard when a strictly newer version arrives.
   * Equal or older versions keep the guard so the prompt stays suppressed.
   */
  private maybeClearInstallLaterGuard(incomingVersion: string | undefined) {
    if (!this.installLaterVersion || !incomingVersion) return;
    try {
      if (semver.gt(incomingVersion, this.installLaterVersion)) {
        logger.info(
          `Clearing install-later guard (was v${this.installLaterVersion}, incoming v${incomingVersion})`,
        );
        this.installLaterVersion = null;
      }
    } catch (error) {
      logger.warn('Failed to compare versions for install-later guard:', error);
    }
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
    const version = electronApp.getVersion();
    return {
      kind: 'app',
      releaseDate: new Date().toISOString(),
      version,
    };
  }
}

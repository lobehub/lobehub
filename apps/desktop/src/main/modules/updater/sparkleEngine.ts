import { EventEmitter } from 'node:events';
import path from 'node:path';

import type { ProgressInfo, UpdateChannel, UpdateInfo } from '@lobechat/electron-client-ipc';
import { app, net } from 'electron';
import type { SparkleBridge, SparkleBridgeEvent } from 'electron-sparkle-updater';
import { loadSparkleBridge } from 'electron-sparkle-updater';
import semver from 'semver';

import { createLogger } from '@/utils/logger';

import { getSparkleFeedUrl } from './configs';
import type { UpdateEngine, UpdateEngineEvents } from './engine';

const logger = createLogger('modules:updater:sparkle');

const toUpdateInfo = (version: string, event: Partial<SparkleBridgeEvent> = {}): UpdateInfo => ({
  kind: 'app',
  releaseDate: event.releaseDate ?? new Date().toISOString(),
  releaseNotes: event.releaseNotes,
  version,
});

export class SparkleEngine extends EventEmitter<UpdateEngineEvents> implements UpdateEngine {
  readonly kind = 'sparkle';
  private available: UpdateInfo | null = null;
  private progressStartedAt = 0;
  private lastTransferred = 0;
  private downloaded = false;
  private feedUrl = '';
  private finishCheck?: () => void;

  constructor(
    private readonly bridge: SparkleBridge,
    private readonly currentVersion: string,
    private readonly baseUrl: string,
  ) {
    super();
    bridge.setEventHandler(this.handleEvent);
    // Electron shutdown waits for native thread-safe callbacks to be released.
    app.on('will-quit', () => bridge.setEventHandler(null));
  }

  static async create(options: {
    appcastUrl: string;
    currentVersion: string;
  }): Promise<SparkleEngine> {
    const resourcesPath = process.resourcesPath ?? '';
    const bridge = loadSparkleBridge({
      addonPath:
        app.isPackaged && resourcesPath
          ? path.join(resourcesPath, 'sparkle', 'sparkle_bridge.node')
          : undefined,
      isPackaged: app.isPackaged,
      log: (message) => logger.info(message),
      resourcesPath,
    });
    if (!bridge) throw new Error('Sparkle bridge unavailable');

    if (!bridge.init({ appcastUrl: options.appcastUrl })) {
      throw new Error('Sparkle bridge failed to initialize');
    }

    bridge.setAutomaticChecks(false);
    const engine = new SparkleEngine(
      bridge,
      options.currentVersion,
      options.appcastUrl.replace(/\/(stable|canary)\/appcast-[^/]+\.xml$/, ''),
    );
    engine.feedUrl = options.appcastUrl;
    return engine;
  }

  configure = (channel: UpdateChannel) => {
    const feedUrl = getSparkleFeedUrl(this.baseUrl, channel);
    if (feedUrl === this.feedUrl) return;
    if (!this.bridge.init({ appcastUrl: feedUrl }))
      throw new Error('Sparkle feed configuration failed');
    this.feedUrl = feedUrl;
    this.available = null;
    this.downloaded = false;
  };

  checkForUpdates = async () => {
    if (this.downloaded && this.available) {
      if (!(await this.hasNewerRelease(this.available.version))) {
        this.emit('update-downloaded', this.available);
        return;
      }
      // Sparkle resumes a staged update without reading the appcast, so a download that sat
      // unattended would otherwise be installed even after a newer release shipped.
      logger.info(`Discarding downloaded ${this.available.version} for a newer release`);
      this.bridge.discardDownloadedUpdate();
      this.available = null;
      this.downloaded = false;
    }
    // The bridge starts an asynchronous native cycle. Keep it in flight through download
    // so a channel switch cannot reuse the old cycle's events for the new channel.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.finishCheck = undefined;
          reject(new Error('Sparkle update check timed out'));
        },
        15 * 60 * 1000,
      );
      this.finishCheck = () => {
        clearTimeout(timer);
        this.finishCheck = undefined;
        resolve();
      };
      try {
        this.bridge.checkForUpdates();
      } catch (error) {
        clearTimeout(timer);
        this.finishCheck = undefined;
        reject(error);
      }
    });
  };

  // Sparkle starts downloading as soon as the silent driver accepts the found update.
  downloadUpdate = async () => {};

  installOnQuit = () => this.bridge.installUpdateOnQuit();

  isActive = () => true;

  quitAndInstall = () => this.bridge.installUpdateNow();

  private handleEvent = (event: SparkleBridgeEvent) => {
    switch (event.type) {
      case 'checking': {
        this.emit('checking-for-update');
        return;
      }
      case 'update-available': {
        this.available = toUpdateInfo(event.version ?? '', event);
        this.progressStartedAt = 0;
        this.lastTransferred = 0;
        this.emit('update-available', this.available);
        return;
      }
      case 'download-progress': {
        this.handleProgress(event);
        return;
      }
      case 'update-downloaded': {
        const info = this.available ?? toUpdateInfo(event.version ?? '');
        this.available = event.version ? { ...info, version: event.version } : info;
        this.downloaded = true;
        this.emit('update-downloaded', this.available);
        this.finishCheck?.();
        return;
      }
      case 'update-not-available': {
        this.emit('update-not-available', toUpdateInfo(this.currentVersion));
        this.finishCheck?.();
        return;
      }
      case 'error': {
        this.emit('error', new Error(event.message ?? 'Sparkle update failed'));
        this.finishCheck?.();
        return;
      }
      default: {
        logger.debug(`Ignoring Sparkle event: ${event.type}`);
      }
    }
  };

  private async hasNewerRelease(downloadedVersion: string) {
    if (!this.feedUrl) return false;
    try {
      const response = await net.fetch(this.feedUrl, { cache: 'no-store' });
      if (!response.ok) return false;
      const appcast = await response.text();
      return [...appcast.matchAll(/<sparkle:shortVersionString>([^<]+)</g)].some(
        ([, version]) => semver.valid(version) && semver.gt(version, downloadedVersion),
      );
    } catch (error) {
      logger.warn('Failed to read the appcast for a newer release:', error);
      return false;
    }
  }

  private handleProgress(event: SparkleBridgeEvent) {
    if (event.phase !== 'download') return;

    const transferred = event.transferred ?? 0;
    if (event.fallback || transferred < this.lastTransferred) {
      this.progressStartedAt = 0;
      this.lastTransferred = 0;
    }

    const now = Date.now();
    if (!this.progressStartedAt) this.progressStartedAt = now;
    const elapsedSeconds = (now - this.progressStartedAt) / 1000;

    const progress: ProgressInfo = {
      bytesPerSecond: elapsedSeconds > 0 ? Math.round(transferred / elapsedSeconds) : 0,
      percent: event.percent ?? 0,
      total: event.total ?? 0,
      transferred,
    };
    this.lastTransferred = transferred;
    this.emit('download-progress', progress);
  }
}

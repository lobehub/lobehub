import { EventEmitter } from 'node:events';
import path from 'node:path';

import { app } from 'electron';
import type { SparkleBridge, SparkleBridgeEvent } from 'electron-sparkle-updater';
import { loadSparkleBridge } from 'electron-sparkle-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';

import { createLogger } from '@/utils/logger';

import type { UpdateEngine, UpdateEngineEvents } from './engine';

const logger = createLogger('modules:updater:sparkle');

const toUpdateInfo = (version: string, event: Partial<SparkleBridgeEvent> = {}): UpdateInfo => ({
  files: [],
  path: '',
  releaseDate: event.releaseDate ?? new Date().toISOString(),
  releaseName: event.releaseName,
  releaseNotes: event.releaseNotes,
  sha512: '',
  version,
});

export class SparkleEngine extends EventEmitter<UpdateEngineEvents> implements UpdateEngine {
  readonly kind = 'sparkle';
  private available: UpdateInfo | null = null;
  private progressStartedAt = 0;
  private lastTransferred = 0;

  constructor(
    private readonly bridge: SparkleBridge,
    private readonly currentVersion: string,
  ) {
    super();
    bridge.setEventHandler(this.handleEvent);
  }

  static async create(options: {
    appcastUrl: string;
    currentVersion: string;
  }): Promise<SparkleEngine | null> {
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
    if (!bridge) return null;

    if (!bridge.init({ appcastUrl: options.appcastUrl })) {
      logger.warn('Sparkle bridge failed to initialize, falling back to electron-updater');
      return null;
    }

    bridge.setAutomaticChecks(false);
    return new SparkleEngine(bridge, options.currentVersion);
  }

  checkForUpdates = async () => {
    this.bridge.checkForUpdates();
  };

  // Sparkle starts downloading as soon as the silent driver accepts the found update.
  downloadUpdate = async () => {};

  installOnQuit = () => this.bridge.installUpdateOnQuit();

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
        this.emit('update-downloaded', event.version ? { ...info, version: event.version } : info);
        return;
      }
      case 'update-not-available': {
        this.emit('update-not-available', toUpdateInfo(this.currentVersion));
        return;
      }
      case 'error': {
        this.emit('error', new Error(event.message ?? 'Sparkle update failed'));
        return;
      }
      default: {
        logger.debug(`Ignoring Sparkle event: ${event.type}`);
      }
    }
  };

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
      delta: transferred - this.lastTransferred,
      percent: event.percent ?? 0,
      total: event.total ?? 0,
      transferred,
    };
    this.lastTransferred = transferred;
    this.emit('download-progress', progress);
  }
}

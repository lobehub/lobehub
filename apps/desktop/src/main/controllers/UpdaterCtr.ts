import type { UpdateChannel, UpdaterState } from '@lobechat/electron-client-ipc';

import {
  coerceStoredUpdateChannel,
  resolveUpdateChannelInput,
  UPDATE_CHANNEL,
} from '@/modules/updater/configs';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:UpdaterCtr');

export default class UpdaterCtr extends ControllerModule {
  static override readonly groupName = 'autoUpdate';
  /**
   * Check for updates
   */
  @IpcMethod()
  async checkForUpdates() {
    logger.info('Check for updates requested');
    await this.app.updaterManager.checkForUpdates({ manual: true });
  }

  /**
   * Download update
   */
  @IpcMethod()
  async downloadUpdate() {
    logger.info('Download update requested');
    await this.app.updaterManager.downloadUpdate();
  }

  /**
   * Quit application and install update
   */
  @IpcMethod()
  quitAndInstallUpdate() {
    logger.info('Quit and install update requested');
    this.app.updaterManager.installNow();
  }

  /**
   * Install update on next startup
   */
  @IpcMethod()
  installLater() {
    logger.info('Install later requested');
    this.app.updaterManager.installLater();
  }

  @IpcMethod()
  async getUpdateChannel(): Promise<UpdateChannel> {
    const storedChannel = this.app.storeManager.get('updateChannel');
    if (storedChannel === undefined) return UPDATE_CHANNEL;

    const normalizedChannel = coerceStoredUpdateChannel(storedChannel);

    if (storedChannel !== normalizedChannel) {
      logger.info(`Migrating legacy update channel: ${storedChannel} -> ${normalizedChannel}`);
      this.app.storeManager.set('updateChannel', normalizedChannel);
    }

    return normalizedChannel;
  }

  /**
   * Get the build-time channel (stable, canary, beta, or legacy nightly).
   * Used for display in About page to distinguish pre-release builds.
   */
  @IpcMethod()
  async getBuildChannel(): Promise<string> {
    const { BUILD_CHANNEL } = await import('@/modules/updater/configs');
    return BUILD_CHANNEL;
  }

  @IpcMethod()
  async setUpdateChannel(channel: UpdateChannel): Promise<void> {
    const normalizedChannel = resolveUpdateChannelInput(channel);

    if (!normalizedChannel) {
      logger.warn(`Invalid update channel: ${channel}, ignoring`);
      return;
    }

    if (channel !== normalizedChannel) {
      logger.info(`Normalizing legacy update channel: ${channel} -> ${normalizedChannel}`);
    }

    logger.info(`Set update channel requested: ${normalizedChannel}`);
    this.app.storeManager.set('updateChannel', normalizedChannel);
    this.app.updaterManager.switchChannel(normalizedChannel);
  }

  @IpcMethod()
  async getUpdaterState(): Promise<UpdaterState> {
    return this.app.updaterManager.getUpdaterState();
  }
}

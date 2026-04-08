import type { UpdateChannel, UpdaterState } from '@lobechat/electron-client-ipc';

import { UPDATE_CHANNEL } from '@/modules/updater/configs';
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
    return this.app.storeManager.get('updateChannel') ?? UPDATE_CHANNEL;
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
    const validChannels = new Set<UpdateChannel>(['stable', 'canary']);
    if (!validChannels.has(channel)) {
      logger.warn(`Invalid update channel: ${channel}, ignoring`);
      return;
    }

    logger.info(`Set update channel requested: ${channel}`);
    this.app.storeManager.set('updateChannel', channel);
    this.app.updaterManager.switchChannel(channel);
  }

  @IpcMethod()
  async getUpdaterState(): Promise<UpdaterState> {
    return this.app.updaterManager.getUpdaterState();
  }
}

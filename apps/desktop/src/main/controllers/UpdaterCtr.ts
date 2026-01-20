import { STORE_DEFAULTS } from '@/const/store';
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

  /**
   * Get auto check update setting
   */
  @IpcMethod()
  getAutoCheckUpdate(): boolean {
    return this.app.storeManager.get('autoCheckUpdate', STORE_DEFAULTS.autoCheckUpdate);
  }

  /**
   * Set auto check update setting
   */
  @IpcMethod()
  setAutoCheckUpdate(enabled: boolean): void {
    logger.info(`Setting auto check update to: ${enabled}`);
    this.app.storeManager.set('autoCheckUpdate', enabled);
    this.app.updaterManager.setAutoCheckEnabled(enabled);
  }
}

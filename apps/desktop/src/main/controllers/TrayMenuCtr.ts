import {
  ShowTrayNotificationParams,
  UpdateTrayIconParams,
  UpdateTrayTooltipParams,
} from '@lobechat/electron-client-ipc';

import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

// Create logger
const logger = createLogger('controllers:TrayMenuCtr');

export default class TrayMenuCtr extends ControllerModule {
  static override readonly groupName = 'tray';
  async toggleMainWindow() {
    logger.debug('Toggle main window visibility via shortcut');
    const mainWindow = this.app.browserManager.getMainWindow();
    mainWindow.toggleVisible();
  }

  /**
   * Show tray balloon notification
   * @param options Balloon options
   * @returns Operation result
   */
  @IpcMethod()
  async showNotification(options: ShowTrayNotificationParams) {
    logger.debug('Show tray balloon notification');

    if (process.platform === 'win32') {
      const mainTray = this.app.trayManager.getMainTray();

      if (mainTray) {
        mainTray.displayBalloon({
          content: options.content,
          iconType: options.iconType || 'info',
          title: options.title,
        });

        return { success: true };
      }
    }

    return {
      error: 'Tray notifications are only supported on Windows platform',
      success: false,
    };
  }

  /**
   * Update tray icon
   * @param options Icon options
   * @returns Operation result
   */
  @IpcMethod()
  async updateTrayIcon(options: UpdateTrayIconParams) {
    logger.debug('Update tray icon');

    if (process.platform === 'win32') {
      const mainTray = this.app.trayManager.getMainTray();

      if (mainTray && options.iconPath) {
        try {
          mainTray.updateIcon(options.iconPath);
          return { success: true };
        } catch (error) {
          logger.error('Failed to update tray icon:', error);
          return {
            error: String(error),
            success: false,
          };
        }
      }
    }

    return {
      error: 'Tray functionality is only supported on Windows platform',
      success: false,
    };
  }

  /**
   * Update tray tooltip text
   * @param options Tooltip text options
   * @returns Operation result
   */
  @IpcMethod()
  async updateTrayTooltip(options: UpdateTrayTooltipParams) {
    logger.debug('Update tray tooltip text');

    if (process.platform === 'win32') {
      const mainTray = this.app.trayManager.getMainTray();

      if (mainTray && options.tooltip) {
        mainTray.updateTooltip(options.tooltip);
        return { success: true };
      }
    }

    return {
      error: 'Tray functionality is only supported on Windows platform',
      success: false,
    };
  }
}

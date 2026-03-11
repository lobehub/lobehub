import {
  type DesktopNotificationResult,
  type ShowDesktopNotificationParams,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

/**
 * Desktop notification service
 */
export class DesktopNotificationService {
  /**
   * Show desktop notification (only when window is hidden)
   * @param params Notification parameters
   * @returns Notification result
   */
  async showNotification(
    params: ShowDesktopNotificationParams,
  ): Promise<DesktopNotificationResult> {
    return ensureElectronIpc().notification.showDesktopNotification(params);
  }

  /**
   * Check if main window is hidden
   * @returns Whether it is hidden
   */
  async isMainWindowHidden(): Promise<boolean> {
    return ensureElectronIpc().notification.isMainWindowHidden();
  }
}

export const desktopNotificationService = new DesktopNotificationService();

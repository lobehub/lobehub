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
   * Show a desktop notification.
   * By default notifications only appear when the main window is hidden or unfocused.
   * Callers can override this with `force` for high-priority reminders.
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

  /**
   * Set the app-level badge count (dock red dot on macOS, Unity counter on Linux,
   * overlay icon on Windows). Pass 0 to clear.
   */
  async setBadgeCount(count: number): Promise<void> {
    return ensureElectronIpc().notification.setBadgeCount(count);
  }
}

export const desktopNotificationService = new DesktopNotificationService();

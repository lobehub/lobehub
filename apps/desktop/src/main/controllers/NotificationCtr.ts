import {
  DesktopNotificationResult,
  ShowDesktopNotificationParams,
} from '@lobechat/electron-client-ipc';
import { Notification, app, systemPreferences } from 'electron';
import { macOS, windows } from 'electron-is';

import { getIpcContext } from '@/utils/ipc';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:NotificationCtr');

export default class NotificationCtr extends ControllerModule {
  static override readonly groupName = 'notification';

  @IpcMethod()
  async getNotificationPermissionStatus(): Promise<string> {
    if (!Notification.isSupported()) return 'denied';
    // Keep a stable status string for renderer-side UI mapping.
    // Screen3 expects macOS to return 'authorized' when granted.
    if (!macOS()) return 'authorized';

    // Electron 38 no longer exposes `systemPreferences.getNotificationSettings()` in types,
    // and some runtimes don't provide it at all. Use the renderer's Notification.permission
    // as a reliable fallback.
    const context = getIpcContext();
    const sender = context?.sender;
    if (!sender) return 'notDetermined';
    const permission = await sender.executeJavaScript('Notification.permission', true);
    return permission === 'granted' ? 'authorized' : 'denied';
  }

  @IpcMethod()
  async requestNotificationPermission(): Promise<void> {
    logger.debug('Requesting notification permission by sending a test notification');

    if (!Notification.isSupported()) {
      logger.warn('System does not support desktop notifications');
      return;
    }

    // On macOS, ask permission via Web Notification API first when possible.
    // This helps keep `Notification.permission` in sync for subsequent status checks.
    if (macOS()) {
      try {
        const mainWindow = this.app.browserManager.getMainWindow().browserWindow;
        await mainWindow.webContents.executeJavaScript('Notification.requestPermission()', true);
      } catch (error) {
        logger.debug(
          'Notification.requestPermission() failed or is unavailable, continuing with test notification',
          error,
        );
      }
    }

    const notification = new Notification({
      body: 'LobeHub can now send you notifications.',
      title: 'Notification Permission',
    });

    notification.show();
  }
  /**
   * Set up desktop notifications after the application is ready
   */
  afterAppReady() {
    this.setupNotifications();
  }

  /**
   * Set up desktop notification permissions and configuration
   */
  private setupNotifications() {
    logger.debug('Setting up desktop notifications');

    try {
      // Check notification support
      if (!Notification.isSupported()) {
        logger.warn('Desktop notifications are not supported on this platform');
        return;
      }

      // On macOS, we may need to explicitly request notification permissions
      if (macOS()) {
        logger.debug('macOS detected, notification permissions should be handled by system');
      }

      // Set app user model ID on Windows
      if (windows()) {
        app.setAppUserModelId('com.lobehub.chat');
        logger.debug('Set Windows App User Model ID for notifications');
      }

      logger.info('Desktop notifications setup completed');
    } catch (error) {
      logger.error('Failed to setup desktop notifications:', error);
    }
  }
  /**
   * Show system desktop notification (only when window is hidden)
   */
  @IpcMethod()
  async showDesktopNotification(
    params: ShowDesktopNotificationParams,
  ): Promise<DesktopNotificationResult> {
    logger.debug('Received desktop notification request:', params);

    try {
      // Check notification support
      if (!Notification.isSupported()) {
        logger.warn('System does not support desktop notifications');
        return { error: 'Desktop notifications not supported', success: false };
      }

      // Check if window is hidden
      const isWindowHidden = this.isMainWindowHidden();

      if (!isWindowHidden) {
        logger.debug('Main window is visible, skipping desktop notification');
        return { reason: 'Window is visible', skipped: true, success: true };
      }

      logger.info('Window is hidden, showing desktop notification:', params.title);

      const notification = new Notification({
        body: params.body,
        // Add more configuration to ensure notifications display properly
        hasReply: false,
        silent: params.silent || false,
        timeoutType: 'default',
        title: params.title,
        urgency: 'normal',
      });

      // Add more event listeners for debugging
      notification.on('show', () => {
        logger.info('Notification shown');
      });

      notification.on('click', () => {
        logger.debug('User clicked notification, showing main window');
        const mainWindow = this.app.browserManager.getMainWindow();
        mainWindow.show();
        mainWindow.browserWindow.focus();
      });

      notification.on('close', () => {
        logger.debug('Notification closed');
      });

      notification.on('failed', (error) => {
        logger.error('Notification display failed:', error);
      });

      // Use Promise to ensure notification is shown
      return new Promise((resolve) => {
        notification.show();

        // Give the notification some time to display, then check the result
        setTimeout(() => {
          logger.info('Notification display call completed');
          resolve({ success: true });
        }, 100);
      });
    } catch (error) {
      logger.error('Failed to show desktop notification:', error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      };
    }
  }

  /**
   * Check if the main window is hidden
   */
  @IpcMethod()
  isMainWindowHidden(): boolean {
    try {
      const mainWindow = this.app.browserManager.getMainWindow();
      const browserWindow = mainWindow.browserWindow;

      // If window is destroyed, consider it hidden
      if (browserWindow.isDestroyed()) {
        return true;
      }

      // Check if window is visible and focused
      const isVisible = browserWindow.isVisible();
      const isFocused = browserWindow.isFocused();
      const isMinimized = browserWindow.isMinimized();

      logger.debug('Window state check:', { isFocused, isMinimized, isVisible });

      // Window is hidden if: not visible, minimized, or not focused
      return !isVisible || isMinimized || !isFocused;
    } catch (error) {
      logger.error('Failed to check window state:', error);
      return true; // Consider window hidden on error to ensure notifications can be shown
    }
  }
}

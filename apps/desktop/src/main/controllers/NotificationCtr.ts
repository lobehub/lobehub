import type {
  DesktopNotificationResult,
  ShowDesktopNotificationParams,
} from '@lobechat/electron-client-ipc';
import { app, Notification } from 'electron';

import { createLogger } from '@/utils/logger';
import * as electronIs from '@/utils/platform';

import { ControllerModule, IpcMethod } from './index';
import {
  isMainWindowHidden,
  openNotificationTarget,
  showElectronNotification,
  toLoggableNotificationParams,
} from './notificationShared';

const logger = createLogger('controllers:NotificationCtr');

export { toLoggableNotificationParams };

export default class NotificationCtr extends ControllerModule {
  static override readonly groupName = 'notification';

  @IpcMethod()
  async getNotificationPermissionStatus(): Promise<string> {
    if (!Notification.isSupported()) return 'denied';
    return 'authorized';
  }

  @IpcMethod()
  async requestNotificationPermission(): Promise<void> {
    logger.debug('Requesting notification permission by sending a test notification');

    if (!Notification.isSupported()) {
      logger.warn('System does not support desktop notifications');
      return;
    }

    const notification = new Notification({
      body: 'LobeHub can now send you notifications.',
      title: 'Notification Permission',
    });

    notification.show();
  }

  afterAppReady() {
    this.setupNotifications();
  }

  private setupNotifications() {
    logger.debug('Setting up desktop notifications');

    try {
      if (!Notification.isSupported()) {
        logger.warn('Desktop notifications are not supported on this platform');
        return;
      }

      if (electronIs.windows()) {
        app.setAppUserModelId('com.lobehub.chat');
        logger.debug('Set Windows App User Model ID for notifications');
      }

      logger.info('Desktop notifications setup completed');
    } catch (error) {
      logger.error('Failed to setup desktop notifications:', error);
    }
  }

  @IpcMethod()
  async showDesktopNotification(
    params: ShowDesktopNotificationParams,
  ): Promise<DesktopNotificationResult> {
    logger.debug('Received desktop notification request:', toLoggableNotificationParams(params));

    try {
      if (!Notification.isSupported()) {
        logger.warn('System does not support desktop notifications');
        return { error: 'Desktop notifications not supported', success: false };
      }

      const hidden = isMainWindowHidden(this.app);

      if (!params.force && !hidden) {
        logger.debug('Main window is visible, skipping desktop notification');
        return { reason: 'Window is visible', skipped: true, success: true };
      }

      if (params.requestAttention && hidden) {
        this.requestUserAttention();
      }

      logger.info('Showing desktop notification:', params.title);

      return showElectronNotification({
        onClick: () => openNotificationTarget(this.app, params.navigate),
        params,
        urgency: electronIs.linux() ? 'low' : 'normal',
      });
    } catch (error) {
      logger.error('Failed to show desktop notification:', error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      };
    }
  }

  private requestUserAttention(): void {
    try {
      const mainWindow = this.app.browserManager.getMainWindow().browserWindow;
      if (mainWindow.isDestroyed()) return;
      mainWindow.flashFrame(true);
    } catch (error) {
      logger.error('Failed to request user attention:', error);
    }
  }

  @IpcMethod()
  setBadgeCount(count: number): void {
    try {
      app.setBadgeCount(Math.max(0, Math.floor(count)));
    } catch (error) {
      logger.error('Failed to set badge count:', error);
    }
  }

  @IpcMethod()
  isMainWindowHidden(): boolean {
    return isMainWindowHidden(this.app);
  }
}

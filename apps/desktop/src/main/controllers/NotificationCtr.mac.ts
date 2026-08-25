import type {
  DesktopNotificationResult,
  ShowDesktopNotificationParams,
} from '@lobechat/electron-client-ipc';
import {
  getAuthorizationStatus as getMacAuthorizationStatus,
  isSupported as isMacNotificationsSupported,
  onNotificationEvent as onMacNotificationEvent,
  requestAuthorization as requestMacAuthorization,
  showNotification as showMacNotification,
} from '@lobechat/electron-mac-notifications';
import { app, Notification } from 'electron';

import { getIpcContext } from '@/utils/ipc';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';
import {
  isMainWindowHidden,
  openNotificationTarget,
  rememberNavigate,
  showElectronNotification,
  toLoggableNotificationParams,
} from './notificationShared';

const logger = createLogger('controllers:NotificationCtr');

export { toLoggableNotificationParams };

export default class NotificationCtr extends ControllerModule {
  static override readonly groupName = 'notification';

  private readonly navigateByNotificationId = new Map<
    string,
    ShowDesktopNotificationParams['navigate']
  >();

  @IpcMethod()
  async getNotificationPermissionStatus(): Promise<string> {
    if (isMacNotificationsSupported()) {
      const status = await getMacAuthorizationStatus();
      if (status !== 'unsupported') {
        if (status === 'authorized' || status === 'provisional') return 'authorized';
        return status;
      }
    }

    if (!Notification.isSupported()) return 'denied';

    const context = getIpcContext();
    const sender = context?.sender;
    if (!sender) return 'notDetermined';
    const permission = await sender.executeJavaScript('Notification.permission', true);
    return permission === 'granted' ? 'authorized' : 'denied';
  }

  @IpcMethod()
  async requestNotificationPermission(): Promise<void> {
    if (isMacNotificationsSupported()) {
      const granted = await requestMacAuthorization();
      logger.debug('macOS notification authorization requested, granted:', granted);
      return;
    }

    logger.debug('Requesting notification permission by sending a test notification');

    if (!Notification.isSupported()) {
      logger.warn('System does not support desktop notifications');
      return;
    }

    try {
      const mainWindow = this.app.browserManager.getMainWindow().browserWindow;
      await mainWindow.webContents.executeJavaScript('Notification.requestPermission()', true);
    } catch (error) {
      logger.debug(
        'Notification.requestPermission() failed or is unavailable, continuing with test notification',
        error,
      );
    }

    const notification = new Notification({
      body: 'LobeHub can now send you notifications.',
      title: 'Notification Permission',
    });

    notification.show();
  }

  afterAppReady() {
    this.setupMacNotificationClicks();
  }

  private setupMacNotificationClicks() {
    if (!isMacNotificationsSupported()) return;

    onMacNotificationEvent((event) => {
      if (event.type !== 'clicked') return;
      logger.debug('macOS notification clicked:', event.id);
      const navigate = this.navigateByNotificationId.get(event.id);
      this.navigateByNotificationId.delete(event.id);
      openNotificationTarget(this.app, navigate);
    });
  }

  private async showViaMacNotifications(
    params: ShowDesktopNotificationParams,
  ): Promise<DesktopNotificationResult | undefined> {
    try {
      const result = await showMacNotification({
        body: params.body,
        sender: params.sender,
        silent: params.silent,
        title: params.title,
      });

      if (!result.ok) {
        logger.warn('macOS notification addon failed, falling back to Electron:', result.reason);
        return undefined;
      }

      rememberNavigate(this.navigateByNotificationId, result.id, params.navigate);
      logger.info('macOS notification shown via native addon:', result.id);
      return { success: true };
    } catch (error) {
      logger.error('macOS notification addon threw, falling back to Electron:', error);
      return undefined;
    }
  }

  @IpcMethod()
  async showDesktopNotification(
    params: ShowDesktopNotificationParams,
  ): Promise<DesktopNotificationResult> {
    logger.debug('Received desktop notification request:', toLoggableNotificationParams(params));

    try {
      const hidden = isMainWindowHidden(this.app);

      if (!params.force && !hidden) {
        logger.debug('Main window is visible, skipping desktop notification');
        return { reason: 'Window is visible', skipped: true, success: true };
      }

      if (params.requestAttention && hidden) {
        this.requestUserAttention();
      }

      if (isMacNotificationsSupported()) {
        const macResult = await this.showViaMacNotifications(params);
        if (macResult) return macResult;
      }

      if (!Notification.isSupported()) {
        logger.warn('System does not support desktop notifications');
        return { error: 'Desktop notifications not supported', success: false };
      }

      logger.info('Showing desktop notification:', params.title);

      return showElectronNotification({
        onClick: () => openNotificationTarget(this.app, params.navigate),
        params,
        urgency: 'normal',
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
      app.dock?.bounce?.('informational');
    } catch (error) {
      logger.error('Failed to request user attention:', error);
    }
  }

  @IpcMethod()
  setBadgeCount(count: number): void {
    try {
      const next = Math.max(0, Math.floor(count));
      app.setBadgeCount(next);
      app.dock?.setBadge(next > 0 ? String(next) : '');
    } catch (error) {
      logger.error('Failed to set badge count:', error);
    }
  }

  @IpcMethod()
  isMainWindowHidden(): boolean {
    return isMainWindowHidden(this.app);
  }
}

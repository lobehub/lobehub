import type {
  DesktopNotificationResult,
  ShowDesktopNotificationParams,
} from '@lobechat/electron-client-ipc';
import { Notification } from 'electron';

import type { App } from '@/core/App';
import { createLogger } from '@/utils/logger';

const logger = createLogger('controllers:NotificationCtr');

export const NAVIGATE_MAP_LIMIT = 100;

export const toLoggableNotificationParams = (params: ShowDesktopNotificationParams) => {
  if (!params.sender?.avatarDataUrl) return params;
  return {
    ...params,
    sender: { ...params.sender, avatarDataUrl: '[redacted]' },
  };
};

export const isMainWindowHidden = (app: App): boolean => {
  try {
    const browserWindow = app.browserManager.getMainWindow().browserWindow;
    if (browserWindow.isDestroyed()) return true;

    const isVisible = browserWindow.isVisible();
    const isFocused = browserWindow.isFocused();
    const isMinimized = browserWindow.isMinimized();
    logger.debug('Window state check:', { isFocused, isMinimized, isVisible });
    return !isVisible || isMinimized || !isFocused;
  } catch (error) {
    logger.error('Failed to check window state:', error);
    return true;
  }
};

export const openNotificationTarget = (
  app: App,
  navigate?: ShowDesktopNotificationParams['navigate'],
) => {
  app.browserManager.showMainWindow();
  if (navigate?.path) {
    app.browserManager.getMainWindow().broadcast('navigate', navigate);
  }
};

export const rememberNavigate = (
  map: Map<string, ShowDesktopNotificationParams['navigate']>,
  id: string,
  navigate: ShowDesktopNotificationParams['navigate'],
) => {
  if (!navigate?.path) return;
  map.set(id, navigate);
  if (map.size <= NAVIGATE_MAP_LIMIT) return;
  const oldest = map.keys().next().value;
  if (oldest) map.delete(oldest);
};

export const showElectronNotification = ({
  onClick,
  params,
  urgency,
}: {
  onClick: () => void;
  params: ShowDesktopNotificationParams;
  urgency: 'low' | 'normal';
}): Promise<DesktopNotificationResult> => {
  const notification = new Notification({
    body: params.body,
    hasReply: false,
    silent: params.silent || false,
    timeoutType: 'default',
    title: params.title,
    urgency,
  });

  notification.on('show', () => {
    logger.info('Notification shown');
  });

  notification.on('click', () => {
    logger.debug('User clicked notification, showing main window');
    onClick();
  });

  notification.on('close', () => {
    logger.debug('Notification closed');
  });

  notification.on('failed', (error) => {
    logger.error('Notification display failed:', error);
  });

  return new Promise((resolve) => {
    notification.show();
    setTimeout(() => {
      logger.info('Notification display call completed');
      resolve({ success: true });
    }, 100);
  });
};

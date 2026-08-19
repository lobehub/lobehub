export interface DesktopNotificationSender {
  /**
   * PNG data URL rendered by the caller; when present on macOS the
   * notification is styled as a communication notification with this avatar.
   */
  avatarDataUrl?: string;
  conversationId: string;
  name: string;
}

export interface ShowDesktopNotificationParams {
  body: string;
  force?: boolean;
  /**
   * SPA path to navigate to when the user clicks the notification.
   * Reuses the existing `navigate` main-broadcast pipeline, so it requires
   * `DesktopNavigationBridge` to be mounted on the renderer side.
   *
   * `escape` tells the renderer to use this path literally instead of applying
   * the currently active workspace prefix.
   */
  navigate?: { escape?: boolean; path: string; replace?: boolean };
  requestAttention?: boolean;
  sender?: DesktopNotificationSender;
  silent?: boolean;
  title: string;
}

export interface DesktopNotificationResult {
  error?: string;
  reason?: string;
  skipped?: boolean;
  success: boolean;
}

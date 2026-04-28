export interface ShowDesktopNotificationParams {
  body: string;
  force?: boolean;
  /**
   * SPA path to navigate to when the user clicks the notification.
   * Reuses the existing `navigate` main-broadcast pipeline, so it requires
   * `DesktopNavigationBridge` to be mounted on the renderer side.
   */
  navigate?: { path: string; replace?: boolean };
  requestAttention?: boolean;
  silent?: boolean;
  title: string;
}

export interface DesktopNotificationResult {
  error?: string;
  reason?: string;
  skipped?: boolean;
  success: boolean;
}

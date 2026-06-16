export interface ShowDesktopNotificationParams {
  body: string;
  force?: boolean;
  /**
   * Image source for the notification's avatar — an absolute `http(s)` URL or a
   * `data:` URL. The main process converts it to a `NativeImage`: Win/Linux show
   * it as the notification's main icon, macOS as the right-side thumbnail. Emoji
   * or relative-path avatars should be omitted (the OS falls back to the app icon).
   */
  icon?: string;
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

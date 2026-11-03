export type CompletionNotificationSound = 'lobehub' | 'system';

export type CompletionBuiltinSound = 'glassBell' | 'lobehub' | 'softTone' | 'xylophone';

export const COMPLETION_BUILTIN_SOUNDS = [
  'lobehub',
  'glassBell',
  'softTone',
  'xylophone',
] as const satisfies readonly CompletionBuiltinSound[];

export interface CompletionSoundSettings {
  /** Bundled chime used while nothing is imported. */
  builtin: CompletionBuiltinSound;
  /** In-app chime, played only while the window has focus. */
  enabled: boolean;
  /** Imported audio or sound pack display name; absent for the built-in sound. */
  name?: string;
  /** Sound the background notification banner carries. */
  notificationSound: CompletionNotificationSound;
  /** macOS System Settings has notification sounds off for the app. */
  systemSoundDisabled?: boolean;
  volume: number;
}

export interface CompletionSoundPlayback {
  builtin?: CompletionBuiltinSound;
  dataUrl?: string;
  play: boolean;
  volume: number;
}

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
  /**
   * macOS only: a file name registered under the bundle's `Library/Sounds`. Falls back to
   * the system default sound when absent — an unbundled name would silence the banner.
   */
  soundName?: string;
  title: string;
}

export interface DesktopNotificationResult {
  error?: string;
  reason?: string;
  skipped?: boolean;
  success: boolean;
}

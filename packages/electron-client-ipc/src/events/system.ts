import type { ElectronAppState, ThemeAppearance, ThemeMode } from '../types';

export interface SystemBroadcastEvents {
  /**
   * Fired when a piece of the app state changes after boot (e.g. the user
   * switches the Windows shell in settings). Carries only the changed fields;
   * the renderer merges them into its app-state copy and the agent context.
   */
  appStateUpdated: (data: Partial<ElectronAppState>) => void;
  localeChanged: (data: { locale: string }) => void;
  systemThemeChanged: (data: { themeMode: ThemeAppearance }) => void;
  themeChanged: (data: { themeMode: ThemeMode }) => void;
  windowFocused: () => void;
  windowFullscreenChanged: (data: { isFullScreen: boolean }) => void;
}

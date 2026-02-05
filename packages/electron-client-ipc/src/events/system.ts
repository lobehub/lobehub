import type { ThemeAppearance, ThemeMode } from '../types';

export interface SystemBroadcastEvents {
  localeChanged: (data: { locale: string }) => void;
  systemThemeChanged: (data: { themeMode: ThemeAppearance }) => void;
  themeChanged: (data: { themeMode: ThemeMode }) => void;
  windowFocused: () => void;
}

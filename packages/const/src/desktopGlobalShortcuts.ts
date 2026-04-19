import type { DesktopHotkeyConfig, DesktopHotkeyId, DesktopHotkeyItem } from '@lobechat/types';

const combineKeys = (keys: string[]) => keys.join('+');

export const DesktopHotkeyEnum = {
  OpenSettings: 'openSettings',
  ShowApp: 'showApp',
} as const satisfies Record<string, DesktopHotkeyId>;

interface DesktopGlobalShortcutDefault {
  /** Electron `globalShortcut` accelerator; empty string means unregistered. */
  electronAccelerator: string;
  id: DesktopHotkeyId;
  nonEditable?: boolean;
  /** React-hotkey style string for renderer (HotkeyInput, merge defaults). */
  uiKeys: string;
}

/**
 * Single source of truth for desktop (Electron) global shortcut defaults.
 * Main process reads `electronAccelerator`; renderer uses `uiKeys` and metadata.
 */
export const DESKTOP_GLOBAL_SHORTCUT_DEFAULTS = [
  {
    electronAccelerator: '',
    id: DesktopHotkeyEnum.ShowApp,
    uiKeys: '',
  },
  {
    electronAccelerator: 'CommandOrControl+,',
    id: DesktopHotkeyEnum.OpenSettings,
    nonEditable: true,
    uiKeys: combineKeys(['mod', 'comma']),
  },
] as const satisfies readonly DesktopGlobalShortcutDefault[];

export const DESKTOP_HOTKEYS_REGISTRATION: DesktopHotkeyItem[] =
  DESKTOP_GLOBAL_SHORTCUT_DEFAULTS.map((item): DesktopHotkeyItem => {
    const base: DesktopHotkeyItem = {
      id: item.id,
      keys: item.uiKeys,
    };

    return 'nonEditable' in item && item.nonEditable ? { ...base, nonEditable: true } : base;
  });

export const DEFAULT_ELECTRON_DESKTOP_SHORTCUTS: DesktopHotkeyConfig =
  DESKTOP_GLOBAL_SHORTCUT_DEFAULTS.reduce<DesktopHotkeyConfig>((acc, item) => {
    acc[item.id] = item.electronAccelerator;
    return acc;
  }, {} as DesktopHotkeyConfig);

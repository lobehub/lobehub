import type { DesktopHotkeyConfig, DesktopHotkeyId, DesktopHotkeyItem } from '@lobechat/types';

type DesktopHotkeyIdCompatible = DesktopHotkeyId | 'quickComposer';

const combineKeys = (keys: string[]) => keys.join('+');

export const DesktopHotkeyEnum: Record<string, DesktopHotkeyIdCompatible> = {
  OpenSettings: 'openSettings',
  QuickChat: 'quickChat',
  QuickComposer: 'quickComposer',
  ShowApp: 'showApp',
} as const;

interface DesktopGlobalShortcutDefault {
  /** Electron `globalShortcut` accelerator; empty string means unregistered. */
  electronAccelerator: string;
  id: DesktopHotkeyIdCompatible;
  nonEditable?: boolean;
  /** React-hotkey style string for renderer (HotkeyInput, merge defaults). */
  uiKeys: string;
}

/**
 * Single source of truth for desktop (Electron) global shortcut defaults.
 * Main process reads `electronAccelerator`; renderer uses `uiKeys` and metadata.
 */
export const DESKTOP_GLOBAL_SHORTCUT_DEFAULTS: readonly DesktopGlobalShortcutDefault[] = [
  {
    electronAccelerator: 'Alt+Shift+Space',
    id: DesktopHotkeyEnum.QuickComposer,
    uiKeys: combineKeys(['alt', 'shift', 'space']),
  },
  {
    electronAccelerator: '',
    id: DesktopHotkeyEnum.QuickChat,
    uiKeys: '',
  },
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
];

export const DESKTOP_HOTKEYS_REGISTRATION: DesktopHotkeyItem[] =
  DESKTOP_GLOBAL_SHORTCUT_DEFAULTS.map((item): DesktopHotkeyItem => {
    return {
      id: item.id as DesktopHotkeyItem['id'],
      keys: item.uiKeys,
      ...(item.nonEditable ? { nonEditable: true } : {}),
    };
  });

export const DEFAULT_ELECTRON_DESKTOP_SHORTCUTS: DesktopHotkeyConfig =
  DESKTOP_GLOBAL_SHORTCUT_DEFAULTS.reduce<Record<string, string>>((acc, item) => {
    acc[item.id] = item.electronAccelerator;
    return acc;
  }, {}) as DesktopHotkeyConfig;

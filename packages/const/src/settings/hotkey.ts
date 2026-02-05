import type { UserHotkeyConfig } from '@lobechat/types';

import { HOTKEYS_REGISTRATION } from '../hotkeys';

export const DEFAULT_HOTKEY_CONFIG: UserHotkeyConfig = HOTKEYS_REGISTRATION.reduce(
  (acc: UserHotkeyConfig, item) => {
    acc[item.id] = item.keys;
    return acc;
  },
  {} as UserHotkeyConfig,
);

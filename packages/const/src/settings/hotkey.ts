import type { HotkeyId } from '@lobechat/types';

import { HOTKEYS_REGISTRATION } from '../hotkeys';

type UserHotkeyConfig = Record<HotkeyId, string>;

export const DEFAULT_HOTKEY_CONFIG: UserHotkeyConfig = HOTKEYS_REGISTRATION.reduce(
  (acc: UserHotkeyConfig, item) => {
    acc[item.id] = item.keys;
    return acc;
  },
  {} as UserHotkeyConfig,
);

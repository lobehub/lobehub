import type { HotkeyId } from '@lobechat/const/hotkeys';

export type {
  DesktopHotkeyConfig,
  DesktopHotkeyId,
  DesktopHotkeyItem,
} from '@lobechat/const/desktopGlobalShortcuts';
export type { HotkeyGroupId, HotkeyId, HotkeyItem, HotkeyScopeId } from '@lobechat/const/hotkeys';

export type HotkeyI18nTranslations = Record<
  HotkeyId,
  {
    desc?: string;
    title: string;
  }
>;

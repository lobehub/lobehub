import type { DesktopHotkeyItem, HotkeyItem } from '@lobechat/types';
import {
  DesktopHotkeyEnum,
  HotkeyEnum,
  HotkeyGroupEnum,
  HotkeyScopeEnum,
  KeyEnum,
} from '@lobechat/types';

const combineKeys = (keys: string[]) => keys.join('+');

export type HotkeyRegistration = HotkeyItem[];

// mod is the command key on Mac, alt is the ctrl key on Windows
export const HOTKEYS_REGISTRATION: HotkeyRegistration = [
  // basic
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.CommandPalette,
    keys: combineKeys([KeyEnum.Mod, 'k']),
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.Search,
    keys: combineKeys([KeyEnum.Mod, 'j']),
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.SwitchAgent,
    keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Number]),
    nonEditable: true,
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.NavigateToChat,
    keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Backquote]),
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.ToggleLeftPanel,
    keys: combineKeys([KeyEnum.Mod, KeyEnum.BracketLeft]),
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.ToggleRightPanel,
    keys: combineKeys([KeyEnum.Mod, KeyEnum.BracketRight]),
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.OpenHotkeyHelper,
    keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Shift, KeyEnum.QuestionMark]),
    scopes: [HotkeyScopeEnum.Global],
  },
  // Chat
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.ToggleZenMode,
    keys: combineKeys([KeyEnum.Mod, KeyEnum.Backslash]),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.OpenChatSettings,
    keys: combineKeys([KeyEnum.Alt, KeyEnum.Comma]),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.RegenerateMessage,
    keys: combineKeys([KeyEnum.Alt, 'r']),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.DeleteLastMessage,
    keys: combineKeys([KeyEnum.Alt, 'd']),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.DeleteAndRegenerateMessage,
    keys: combineKeys([KeyEnum.Alt, KeyEnum.Shift, 'r']),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.SaveTopic,
    keys: combineKeys([KeyEnum.Alt, 'n']),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.AddUserMessage,
    keys: combineKeys([KeyEnum.Alt, KeyEnum.Enter]),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.EditMessage,
    keys: combineKeys([KeyEnum.Alt, KeyEnum.LeftDoubleClick]),
    nonEditable: true,
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.ClearCurrentMessages,
    keys: combineKeys([KeyEnum.Alt, KeyEnum.Shift, KeyEnum.Backspace]),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.SaveDocument,
    keys: combineKeys([KeyEnum.Mod, 's']),
    scopes: [HotkeyScopeEnum.Files],
  },
];

type DesktopHotkeyRegistration = DesktopHotkeyItem[];

// Desktop hotkey configuration
export const DESKTOP_HOTKEYS_REGISTRATION: DesktopHotkeyRegistration = [
  {
    id: DesktopHotkeyEnum.ShowApp,
    keys: combineKeys([KeyEnum.Ctrl, 'e']),
  },
  {
    id: DesktopHotkeyEnum.OpenSettings,
    keys: combineKeys([KeyEnum.Mod, KeyEnum.Comma]),
    nonEditable: true,
  },
];

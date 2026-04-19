import type { HotkeyGroupId, HotkeyId, HotkeyRegistration, HotkeyScopeId } from '@lobechat/types';

const combineKeys = (keys: string[]) => keys.join('+');

export const KeyEnum = {
  Alt: 'alt',
  Backquote: 'backquote',
  Backslash: 'backslash',
  Backspace: 'backspace',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
  Comma: 'comma',
  Ctrl: 'ctrl',
  Down: 'down',
  Enter: 'enter',
  Equal: 'equal',
  Esc: 'esc',
  Left: 'left',
  LeftClick: 'left-click',
  LeftDoubleClick: 'left-double-click',
  Meta: 'meta',
  MiddleClick: 'middle-click',
  Minus: 'minus',
  Mod: 'mod',
  Number: '1-9',
  Period: 'period',
  Plus: 'equal',
  QuestionMark: 'slash',
  Quote: 'quote',
  Right: 'right',
  RightClick: 'right-click',
  RightDoubleClick: 'right-double-click',
  Semicolon: 'semicolon',
  Shift: 'shift',
  Slash: 'slash',
  Space: 'space',
  Tab: 'tab',
  Up: 'up',
  Zero: '0',
} as const;

export const HotkeyEnum = {
  AddUserMessage: 'addUserMessage',
  ClearCurrentMessages: 'clearCurrentMessages',
  CommandPalette: 'commandPalette',
  DeleteAndRegenerateMessage: 'deleteAndRegenerateMessage',
  DeleteLastMessage: 'deleteLastMessage',
  EditMessage: 'editMessage',
  NavigateToChat: 'navigateToChat',
  OpenChatSettings: 'openChatSettings',
  OpenHotkeyHelper: 'openHotkeyHelper',
  RegenerateMessage: 'regenerateMessage',
  SaveDocument: 'saveDocument',
  SaveTopic: 'saveTopic',
  Search: 'search',
  ShowApp: 'showApp',
  SwitchAgent: 'switchAgent',
  ToggleLeftPanel: 'toggleLeftPanel',
  ToggleRightPanel: 'toggleRightPanel',
  ToggleZenMode: 'toggleZenMode',
} as const satisfies Record<string, HotkeyId>;

export const HotkeyGroupEnum = {
  Conversation: 'conversation',
  Essential: 'essential',
} as const satisfies Record<string, HotkeyGroupId>;

export const HotkeyScopeEnum = {
  Chat: 'chat',
  Files: 'files',
  Global: 'global',
  Image: 'image',
} as const satisfies Record<string, HotkeyScopeId>;

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

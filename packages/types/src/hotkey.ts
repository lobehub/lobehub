export const KeyEnum = {
  Alt: 'alt',
  Backquote: 'backquote',
  // `
  Backslash: 'backslash',
  // \
  Backspace: 'backspace',
  BracketLeft: 'bracketleft',
  // [
  BracketRight: 'bracketright',
  // ]
  Comma: 'comma',
  // ,
  Ctrl: 'ctrl',
  Down: 'down',
  Enter: 'enter',
  Equal: 'equal',
  // =
  Esc: 'esc',
  Left: 'left',
  LeftClick: 'left-click',
  LeftDoubleClick: 'left-double-click',
  Meta: 'meta',
  // Command on Mac, Win on Win
  MiddleClick: 'middle-click',
  Minus: 'minus',
  // -
  Mod: 'mod',

  Number: '1-9',

  // Command on Mac, Ctrl on Win
  Period: 'period',

  // .
  Plus: 'equal',

  // +
  QuestionMark: 'slash',

  // ?
  Quote: 'quote',
  // '
  Right: 'right',
  RightClick: 'right-click',
  RightDoubleClick: 'right-double-click',

  Semicolon: 'semicolon',
  // ;
  Shift: 'shift',

  Slash: 'slash',
  // /
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
} as const;

export const HotkeyGroupEnum = {
  Conversation: 'conversation',
  Essential: 'essential',
} as const;

export const HotkeyScopeEnum = {
  Chat: 'chat',
  Files: 'files',
  // Default globally registered hotkey scope
  // https://react-hotkeys-hook.vercel.app/docs/documentation/hotkeys-provider
  Global: 'global',

  Image: 'image',
} as const;

export type HotkeyId = (typeof HotkeyEnum)[keyof typeof HotkeyEnum];
export type HotkeyGroupId = (typeof HotkeyGroupEnum)[keyof typeof HotkeyGroupEnum];
export type HotkeyScopeId = (typeof HotkeyScopeEnum)[keyof typeof HotkeyScopeEnum];

export interface HotkeyItem {
  // Hotkey grouping for display purposes
  group: HotkeyGroupId;
  id: HotkeyId;
  keys: string;
  // Whether the hotkey is non-editable
  nonEditable?: boolean;
  // Hotkey scope
  scopes?: HotkeyScopeId[];
}

// ================== Desktop ================== //

export const DesktopHotkeyEnum = {
  OpenSettings: 'openSettings',
  ShowApp: 'showApp',
};

export type DesktopHotkeyId = (typeof DesktopHotkeyEnum)[keyof typeof DesktopHotkeyEnum];

export interface DesktopHotkeyItem {
  id: DesktopHotkeyId;

  keys: string;
  // Whether the hotkey is non-editable
  nonEditable?: boolean;
}

export type DesktopHotkeyConfig = Record<DesktopHotkeyId, string>;

export type HotkeyI18nTranslations = Record<
  HotkeyId,
  {
    desc?: string;
    title: string;
  }
>;

import type { HotkeyGroupId, HotkeyId, HotkeyRegistration, HotkeyScopeId } from '@lobechat/types';

import { isDesktop } from './version';

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
  Delete: 'delete',
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
  CommandPalette: 'commandPalette',
  DeleteAndRegenerateMessage: 'deleteAndRegenerateMessage',
  DeleteLastMessage: 'deleteLastMessage',
  EditMessage: 'editMessage',
  FindInTopic: 'findInTopic',
  MailBack: 'mailBack',
  MailCloseCompose: 'mailCloseCompose',
  MailCompose: 'mailCompose',
  MailDeselectAll: 'mailDeselectAll',
  MailForward: 'mailForward',
  MailGoDrafts: 'mailGoDrafts',
  MailGoInbox: 'mailGoInbox',
  MailGoSent: 'mailGoSent',
  MailGoStarred: 'mailGoStarred',
  MailGoTrash: 'mailGoTrash',
  MailHotkeyHelp: 'mailHotkeyHelp',
  MailMarkRead: 'mailMarkRead',
  MailMarkUnread: 'mailMarkUnread',
  MailNext: 'mailNext',
  MailOpen: 'mailOpen',
  MailPrevious: 'mailPrevious',
  MailPurge: 'mailPurge',
  MailReply: 'mailReply',
  MailReplyAll: 'mailReplyAll',
  MailSaveDraft: 'mailSaveDraft',
  MailSearch: 'mailSearch',
  MailSelect: 'mailSelect',
  MailSelectAll: 'mailSelectAll',
  MailSend: 'mailSend',
  MailStar: 'mailStar',
  MailTrash: 'mailTrash',
  MailTrashDelete: 'mailTrashDelete',
  MailUndo: 'mailUndo',
  NavigateToChat: 'navigateToChat',
  NextTab: 'nextTab',
  OpenChatSettings: 'openChatSettings',
  PrevTab: 'prevTab',
  OpenHotkeyHelper: 'openHotkeyHelper',
  OpenTaskFilter: 'openTaskFilter',
  RegenerateMessage: 'regenerateMessage',
  SaveDocument: 'saveDocument',
  SaveTopic: 'saveTopic',
  Search: 'search',
  ShowApp: 'showApp',
  SwitchAgent: 'switchAgent',
  SwitchTab: 'switchTab',
  ToggleFavorite: 'toggleFavorite',
  ToggleLeftPanel: 'toggleLeftPanel',
  ToggleRightPanel: 'toggleRightPanel',
  ToggleTerminalPanel: 'toggleTerminalPanel',
} as const satisfies Record<string, HotkeyId>;

export const HotkeyGroupEnum = {
  Conversation: 'conversation',
  Essential: 'essential',
  Mail: 'mail',
} as const satisfies Record<string, HotkeyGroupId>;

export const HotkeyScopeEnum = {
  Chat: 'chat',
  Files: 'files',
  Global: 'global',
  Image: 'image',
  Mail: 'mail',
} as const satisfies Record<string, HotkeyScopeId>;

/** Two keys pressed one after the other, as `g` then `i`; recorded by `react-hotkeys-hook` as `g>i`. */
const sequence = (keys: string[]) => keys.join('>');

const mail = (id: HotkeyId, keys: string, nonEditable?: boolean): HotkeyRegistration[number] => ({
  group: HotkeyGroupEnum.Mail,
  id,
  keys,
  ...(nonEditable && { nonEditable }),
  scopes: [HotkeyScopeEnum.Mail],
});

/**
 * The mail page's keys, after Gmail: bare letters, live only while that page is
 * mounted and never while typing. Sequences and the composer's own keys cannot
 * be recorded by the settings input, so they are fixed.
 */
const MAIL_HOTKEYS: HotkeyRegistration = [
  mail(HotkeyEnum.MailCompose, 'c'),
  mail(HotkeyEnum.MailReply, 'r'),
  mail(HotkeyEnum.MailReplyAll, 'a'),
  mail(HotkeyEnum.MailForward, 'f'),
  mail(HotkeyEnum.MailSend, combineKeys([KeyEnum.Mod, KeyEnum.Enter]), true),
  mail(HotkeyEnum.MailSaveDraft, combineKeys([KeyEnum.Mod, 's']), true),
  mail(HotkeyEnum.MailCloseCompose, KeyEnum.Esc, true),
  // `#` is Shift+3; matched by key position, so it holds on any layout.
  mail(HotkeyEnum.MailTrash, combineKeys([KeyEnum.Shift, '3'])),
  mail(HotkeyEnum.MailTrashDelete, KeyEnum.Delete),
  mail(HotkeyEnum.MailPurge, combineKeys([KeyEnum.Shift, KeyEnum.Delete])),
  mail(HotkeyEnum.MailUndo, 'z'),
  mail(HotkeyEnum.MailSearch, KeyEnum.Slash),
  mail(HotkeyEnum.MailNext, 'j'),
  mail(HotkeyEnum.MailPrevious, 'k'),
  mail(HotkeyEnum.MailOpen, KeyEnum.Enter, true),
  mail(HotkeyEnum.MailBack, KeyEnum.Esc, true),
  mail(HotkeyEnum.MailSelect, 'x'),
  mail(HotkeyEnum.MailSelectAll, sequence(['*', 'a']), true),
  mail(HotkeyEnum.MailDeselectAll, sequence(['*', 'n']), true),
  mail(HotkeyEnum.MailMarkRead, combineKeys([KeyEnum.Shift, 'i'])),
  mail(HotkeyEnum.MailMarkUnread, combineKeys([KeyEnum.Shift, 'u'])),
  mail(HotkeyEnum.MailStar, 's'),
  mail(HotkeyEnum.MailGoInbox, sequence(['g', 'i']), true),
  mail(HotkeyEnum.MailGoSent, sequence(['g', 't']), true),
  mail(HotkeyEnum.MailGoDrafts, sequence(['g', 'd']), true),
  mail(HotkeyEnum.MailGoStarred, sequence(['g', 's']), true),
  mail(HotkeyEnum.MailGoTrash, sequence(['g', 'x']), true),
  mail(HotkeyEnum.MailHotkeyHelp, combineKeys([KeyEnum.Shift, KeyEnum.QuestionMark])),
];

/** The mail page's hotkeys; their bare keys only conflict with one another. */
export const MAIL_HOTKEY_IDS: ReadonlySet<HotkeyId> = new Set(MAIL_HOTKEYS.map((item) => item.id));

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
  // Desktop's number shortcuts select titlebar tabs, not agents.
  ...(!isDesktop
    ? [
        {
          group: HotkeyGroupEnum.Essential,
          id: HotkeyEnum.SwitchAgent,
          keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Number]),
          nonEditable: true,
          scopes: [HotkeyScopeEnum.Global],
        },
      ]
    : []),
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.SwitchTab,
    keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Number]),
    nonEditable: true,
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.NextTab,
    keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Tab]),
    nonEditable: true,
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.PrevTab,
    keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Shift, KeyEnum.Tab]),
    nonEditable: true,
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.NavigateToChat,
    keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Shift, KeyEnum.Backquote]),
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
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.ToggleFavorite,
    keys: combineKeys([KeyEnum.Alt, 'f']),
    scopes: [HotkeyScopeEnum.Global],
  },
  {
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.OpenTaskFilter,
    keys: 'f',
    scopes: [HotkeyScopeEnum.Global],
  },
  // Chat
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.FindInTopic,
    keys: combineKeys([KeyEnum.Mod, 'f']),
    scopes: [HotkeyScopeEnum.Chat],
  },
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.ToggleTerminalPanel,
    keys: combineKeys([KeyEnum.Ctrl, KeyEnum.Backquote]),
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
    group: HotkeyGroupEnum.Essential,
    id: HotkeyEnum.SaveDocument,
    keys: combineKeys([KeyEnum.Mod, 's']),
    scopes: [HotkeyScopeEnum.Files],
  },
  ...MAIL_HOTKEYS,
];

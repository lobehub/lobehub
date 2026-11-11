export type HotkeyId =
  | 'addUserMessage'
  | 'commandPalette'
  | 'deleteAndRegenerateMessage'
  | 'deleteLastMessage'
  | 'editMessage'
  | 'findInTopic'
  | 'mailBack'
  | 'mailCloseCompose'
  | 'mailCompose'
  | 'mailDeselectAll'
  | 'mailForward'
  | 'mailGoDrafts'
  | 'mailGoInbox'
  | 'mailGoSent'
  | 'mailGoStarred'
  | 'mailGoTrash'
  | 'mailHotkeyHelp'
  | 'mailMarkRead'
  | 'mailMarkUnread'
  | 'mailNext'
  | 'mailOpen'
  | 'mailPrevious'
  | 'mailPurge'
  | 'mailReply'
  | 'mailReplyAll'
  | 'mailSaveDraft'
  | 'mailSearch'
  | 'mailSelect'
  | 'mailSelectAll'
  | 'mailSend'
  | 'mailStar'
  | 'mailTrash'
  | 'mailTrashDelete'
  | 'mailUndo'
  | 'navigateToChat'
  | 'nextTab'
  | 'openChatSettings'
  | 'prevTab'
  | 'openHotkeyHelper'
  | 'openTaskFilter'
  | 'regenerateMessage'
  | 'saveDocument'
  | 'saveTopic'
  | 'search'
  | 'showApp'
  | 'switchAgent'
  | 'switchTab'
  | 'toggleFavorite'
  | 'toggleLeftPanel'
  | 'toggleRightPanel'
  | 'toggleTerminalPanel';

export type HotkeyGroupId = 'conversation' | 'essential' | 'mail';

export type HotkeyScopeId = 'chat' | 'files' | 'global' | 'image' | 'mail';

export interface HotkeyItem {
  group: HotkeyGroupId;
  id: HotkeyId;
  keys: string;
  nonEditable?: boolean;
  scopes?: HotkeyScopeId[];
}

export type HotkeyRegistration = HotkeyItem[];

export type DesktopHotkeyId = 'openSettings' | 'quickChat' | 'quickComposer' | 'showApp';

export interface DesktopHotkeyItem {
  id: DesktopHotkeyId;
  keys: string;
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

export type HotkeyId =
  | 'addUserMessage'
  | 'clearCurrentMessages'
  | 'commandPalette'
  | 'deleteAndRegenerateMessage'
  | 'deleteLastMessage'
  | 'editMessage'
  | 'navigateToChat'
  | 'openChatSettings'
  | 'openHotkeyHelper'
  | 'regenerateMessage'
  | 'saveDocument'
  | 'saveTopic'
  | 'search'
  | 'showApp'
  | 'switchAgent'
  | 'toggleLeftPanel'
  | 'toggleRightPanel'
  | 'toggleZenMode';

export type HotkeyGroupId = 'conversation' | 'essential';

export type HotkeyScopeId = 'chat' | 'files' | 'global' | 'image';

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

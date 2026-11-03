import type {
  LobeChatGroupChatConfig,
  LobeChatGroupFullConfig,
  LobeChatGroupMetaConfig,
} from '@lobechat/types';

export const DEFAULT_CHAT_GROUP_CHAT_CONFIG: LobeChatGroupChatConfig = {
  allowDM: true,
  openingMessage: '',
  openingQuestions: [],
  revealDM: false,
  systemPrompt: '',
};

export const DEFAULT_CHAT_GROUP_META_CONFIG: LobeChatGroupMetaConfig = {
  description: '',
  title: '',
};

export const DEFAULT_CHAT_GROUP_CONFIG: LobeChatGroupFullConfig = {
  chat: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
  meta: DEFAULT_CHAT_GROUP_META_CONFIG,
};

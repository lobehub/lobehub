import { DEFAULT_CHAT_GROUP_CHAT_CONFIG, DEFAULT_CHAT_GROUP_META_CONFIG } from '@/const/settings';
import { merge } from '@/utils/merge';

import { type State } from './initialState';

const currentChatConfig = (s: State) => merge(DEFAULT_CHAT_GROUP_CHAT_CONFIG, s.config);

const currentMetaConfig = (s: State) => merge(DEFAULT_CHAT_GROUP_META_CONFIG, s.meta);

export const selectors = {
  currentChatConfig,
  currentMetaConfig,
};

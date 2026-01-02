import { DEFAULT_AGENT_META } from '@/const/meta';
import {
  DEFAULT_AGENT_CHAT_CONFIG,
  DEFAULT_AGENT_CONFIG,
  DEFAUTT_AGENT_TTS_CONFIG,
} from '@/const/settings';
import { type LobeAgentChatConfig } from '@/types/agent';
import { merge } from '@/utils/merge';

import { type Store } from './action';

const chatConfig = (s: Store): LobeAgentChatConfig =>
  s.config.chatConfig || DEFAULT_AGENT_CHAT_CONFIG;

const currentAgentConfig = (s: Store) => merge(DEFAULT_AGENT_CONFIG, s.config);

const currentChatConfig = (s: Store) => merge(DEFAULT_AGENT_CHAT_CONFIG, s.config.chatConfig);

const currentMetaConfig = (s: Store) => merge(DEFAULT_AGENT_META, s.meta);

const currentTtsConfig = (s: Store) => merge(DEFAUTT_AGENT_TTS_CONFIG, s.config.tts);

export const DEFAULT_OPENING_QUESTIONS: string[] = [];
export const selectors = {
  chatConfig,
  currentAgentConfig,
  currentChatConfig,
  currentMetaConfig,
  currentTtsConfig,
  openingMessage: (s: Store) => s.config.openingMessage,
  openingQuestions: (s: Store) => s.config.openingQuestions || DEFAULT_OPENING_QUESTIONS,
};

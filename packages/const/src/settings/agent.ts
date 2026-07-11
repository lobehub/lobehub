import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import {
  type LobeAgentChatConfig,
  type LobeAgentConfig,
  type LobeAgentTTSConfig,
  type UserDefaultAgent,
} from '@lobechat/types';

import { DEFAULT_AGENT_META } from '../meta';
import { DEFAULT_MODEL } from './llm';

export const DEFAUTT_AGENT_TTS_CONFIG: LobeAgentTTSConfig = {
  showAllLocaleVoice: false,
  sttLocale: 'auto',
  ttsService: 'openai',
  voice: {
    openai: 'alloy',
  },
};

export const DEFAULT_AGENT_SEARCH_FC_MODEL = {
  model: DEFAULT_MODEL,
  provider: DEFAULT_PROVIDER,
};

export const DEFAULT_AGENT_CHAT_CONFIG: LobeAgentChatConfig = {
  enableAgentMode: true,
  enableCompressHistory: true,
  enableContextCompression: true,
  enableFollowUpChips: false,
  enableHistoryCount: false,
  enableStreaming: true,
  historyCount: 20,
  reasoningBudgetToken: 1024,
  searchFCModel: DEFAULT_AGENT_SEARCH_FC_MODEL,
  searchMode: 'auto',
  selfIteration: {
    enabled: false,
  },
};

export const DEFAULT_AGENT_CONFIG: LobeAgentConfig = {
  // Default to cloud/device execution: `auto` auto-activates the single online
  // device, so a desktop agent runs via the gateway routed to that desktop
  // (enabling device tools like the in-app browser out of the box), and a
  // web/mobile agent transparently drives the user's online desktop device —
  // the cross-device default. With no device online it degrades to
  // `device-unrouted` (the model can still chat / activate a device), never an
  // error. Chat-mode agents stay `none` regardless (see resolveExecutionPlan).
  agencyConfig: { executionTarget: 'auto' },
  chatConfig: DEFAULT_AGENT_CHAT_CONFIG,
  model: DEFAULT_MODEL,
  openingQuestions: [],
  params: {
    frequency_penalty: 0,
    presence_penalty: 0,
    temperature: 1,
    top_p: 1,
  },
  plugins: [],
  provider: DEFAULT_PROVIDER,
  systemRole: '',
  tts: DEFAUTT_AGENT_TTS_CONFIG,
};

export const DEFAULT_AGENT: UserDefaultAgent = {
  config: DEFAULT_AGENT_CONFIG,
  meta: DEFAULT_AGENT_META,
};

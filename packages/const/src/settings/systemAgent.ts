import {
  DEFAULT_EMBEDDING_PROVIDER,
  DEFAULT_MINI_PROVIDER,
  DEFAULT_PROVIDER,
} from '@lobechat/business-const';
import type {
  PromptRewriteSystemAgent,
  SystemAgentItem,
  UserServiceModelConfig,
} from '@lobechat/types';

import { DEFAULT_EMBEDDING_MODEL, DEFAULT_MINI_MODEL, DEFAULT_MODEL } from './llm';

export const DEFAULT_SYSTEM_AGENT_ITEM: SystemAgentItem = {
  model: DEFAULT_MODEL,
  provider: DEFAULT_PROVIDER,
};

export const DEFAULT_MINI_SYSTEM_AGENT_ITEM: SystemAgentItem = {
  model: DEFAULT_MINI_MODEL,
  provider: DEFAULT_MINI_PROVIDER,
};

export const DEFAULT_PROMPT_REWRITE_SYSTEM_AGENT_ITEM: PromptRewriteSystemAgent = {
  enabled: true,
  model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
  provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
};

export const DEFAULT_INPUT_COMPLETION_SYSTEM_AGENT_ITEM: SystemAgentItem = {
  enabled: false,
  model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
  provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
};

export const DEFAULT_FOLLOW_UP_ACTION_SYSTEM_AGENT_ITEM: SystemAgentItem = {
  enabled: false,
  model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
  provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
};

export const DEFAULT_USER_MEMORY_EMBEDDING_SYSTEM_AGENT_ITEM: SystemAgentItem = {
  model: DEFAULT_EMBEDDING_MODEL,
  provider: DEFAULT_EMBEDDING_PROVIDER,
};

export const DEFAULT_SYSTEM_AGENT_CONFIG: UserServiceModelConfig = {
  agentMeta: DEFAULT_SYSTEM_AGENT_ITEM,
  followUpAction: DEFAULT_FOLLOW_UP_ACTION_SYSTEM_AGENT_ITEM,
  generationTopic: DEFAULT_MINI_SYSTEM_AGENT_ITEM,
  historyCompress: DEFAULT_SYSTEM_AGENT_ITEM,
  inputCompletion: DEFAULT_INPUT_COMPLETION_SYSTEM_AGENT_ITEM,
  memoryAnalysisAgentConfig: DEFAULT_MINI_SYSTEM_AGENT_ITEM,
  userMemoryEmbedding: DEFAULT_USER_MEMORY_EMBEDDING_SYSTEM_AGENT_ITEM,
  userMemoryPersonaWriter: DEFAULT_MINI_SYSTEM_AGENT_ITEM,
  promptRewrite: DEFAULT_PROMPT_REWRITE_SYSTEM_AGENT_ITEM,
  thread: DEFAULT_SYSTEM_AGENT_ITEM,
  topic: DEFAULT_MINI_SYSTEM_AGENT_ITEM,
  translation: DEFAULT_MINI_SYSTEM_AGENT_ITEM,
};

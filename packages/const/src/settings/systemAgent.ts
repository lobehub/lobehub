import { DEFAULT_MINI_PROVIDER, DEFAULT_PROVIDER } from '@lobechat/business-const';
import type {
  QueryRewriteSystemAgent,
  SystemAgentItem,
  UserSystemAgentConfig,
} from '@lobechat/types';

import { DEFAULT_MINI_MODEL, DEFAULT_MODEL } from './llm';

export const DEFAULT_SYSTEM_AGENT_ITEM: SystemAgentItem = {
  model: DEFAULT_MODEL,
  provider: DEFAULT_PROVIDER,
};

export const DEFAULT_MINI_SYSTEM_AGENT_ITEM: SystemAgentItem = {
  model: DEFAULT_MINI_MODEL,
  provider: DEFAULT_MINI_PROVIDER,
};

export const DEFAULT_QUERY_REWRITE_SYSTEM_AGENT_ITEM: QueryRewriteSystemAgent = {
  enabled: true,
  model: DEFAULT_MINI_SYSTEM_AGENT_ITEM.model,
  provider: DEFAULT_MINI_SYSTEM_AGENT_ITEM.provider,
};

export const DEFAULT_SYSTEM_AGENT_CONFIG: UserSystemAgentConfig = {
  agentMeta: DEFAULT_SYSTEM_AGENT_ITEM,
  generationTopic: DEFAULT_MINI_SYSTEM_AGENT_ITEM,
  historyCompress: DEFAULT_SYSTEM_AGENT_ITEM,
  queryRewrite: DEFAULT_QUERY_REWRITE_SYSTEM_AGENT_ITEM,
  thread: DEFAULT_SYSTEM_AGENT_ITEM,
  topic: DEFAULT_MINI_SYSTEM_AGENT_ITEM,
  translation: DEFAULT_MINI_SYSTEM_AGENT_ITEM,
};

import type { ModelProviderKey } from '@lobechat/model-runtime';
import type { AiFullModelCard } from 'model-bank';

import type { ChatModelCard } from '../../llm';

export interface ProviderConfig {
  /**
   * whether to auto fetch model lists
   */
  autoFetchModelLists?: boolean;
  /**
   * user defined model cards
   */
  customModelCards?: ChatModelCard[];
  enabled: boolean;
  /**
   * enabled models id
   */
  enabledModels?: string[] | null;
  /**
   * whether fetch on client
   */
  fetchOnClient?: boolean;
  /**
   * the latest fetch model list time
   */
  latestFetchTime?: number;
  /**
   * fetched models from provider side
   */
  remoteModelCards?: ChatModelCard[];
  serverModelLists?: AiFullModelCard[];
}

export type GlobalLLMProviderKey = ModelProviderKey;

export type UserModelProviderConfig = Record<ModelProviderKey, ProviderConfig>;

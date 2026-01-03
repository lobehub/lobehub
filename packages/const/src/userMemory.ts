import { DEFAULT_EMBEDDING_PROVIDER } from '@lobechat/business-const';

import { DEFAULT_EMBEDDING_MODEL } from './settings';

export const DEFAULT_SEARCH_USER_MEMORY_TOP_K = {
  contexts: 0,
  experiences: 0,
  preferences: 3,
};
export interface UserMemoryConfigItem {
  model: string;
  provider: string;
}

export interface UserMemoryConfig {
  embeddingModel: UserMemoryConfigItem;
}

export const DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM: UserMemoryConfigItem = {
  model: DEFAULT_EMBEDDING_MODEL,
  provider: DEFAULT_EMBEDDING_PROVIDER,
};

export const DEFAULT_USER_MEMORY_CONFIG: UserMemoryConfig = {
  embeddingModel: DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM,
};

export const DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS = 1024;

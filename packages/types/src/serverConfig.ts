import type { PartialDeep } from 'type-fest';

import type { IFeatureFlagsState } from '@/config/featureFlags';

import type { ChatModelCard } from './llm';
import type {
  GlobalLLMProviderKey,
  UserDefaultAgent,
  UserImageConfig,
  UserSystemAgentConfig,
} from './user/settings';

export type GlobalMemoryLayer = 'activity' | 'context' | 'experience' | 'identity' | 'preference';

export interface MemoryAgentPublicConfig {
  baseURL?: string;
  contextLimit?: number;
  model?: string;
  provider?: string;
}

export interface MemoryLayerExtractorPublicConfig extends MemoryAgentPublicConfig {
  layers?: Partial<Record<GlobalMemoryLayer, string>>;
}

export interface GlobalMemoryExtractionConfig {
  agentGateKeeper: MemoryAgentPublicConfig;
  agentLayerExtractor: MemoryLayerExtractorPublicConfig;
  concurrency?: number;
  embedding?: MemoryAgentPublicConfig;
}

export interface GlobalMemoryConfig {
  userMemory?: GlobalMemoryExtractionConfig;
}

export interface ServerModelProviderConfig {
  enabled?: boolean;
  enabledModels?: string[];
  fetchOnClient?: boolean;
  /**
   * the model lists defined in server
   */
  serverModelLists?: ChatModelCard[];
}

export type ServerLanguageModel = Partial<Record<GlobalLLMProviderKey, ServerModelProviderConfig>>;

export interface GlobalServerConfig {
  aiProvider: ServerLanguageModel;
  defaultAgent?: PartialDeep<UserDefaultAgent>;
  disableEmailPassword?: boolean;
  enableBusinessFeatures?: boolean;
  /**
   * @deprecated
   */
  enabledOAuthSSO?: boolean;
  enableEmailVerification?: boolean;
  enableKlavis?: boolean;
  enableLobehubSkill?: boolean;
  enableMagicLink?: boolean;
  enableMarketTrustedClient?: boolean;
  enableUploadFileToServer?: boolean;
  image?: PartialDeep<UserImageConfig>;
  memory?: GlobalMemoryConfig;
  oAuthSSOProviders?: string[];
  systemAgent?: PartialDeep<UserSystemAgentConfig>;
  telemetry: {
    langfuse?: boolean;
  };
}

export interface GlobalRuntimeConfig {
  serverConfig: GlobalServerConfig;
  serverFeatureFlags: IFeatureFlagsState;
}

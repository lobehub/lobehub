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

export interface VisualUnderstandingConfig {
  model: string;
  provider: string;
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
  /**
   * Agent Gateway URL for WebSocket-based agent execution.
   * When set, the SPA can offload agent execution to the server and receive
   * events via the Gateway instead of running the agent loop client-side.
   */
  agentGatewayUrl?: string;
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
  enableVisualUnderstanding?: boolean;
  image?: PartialDeep<UserImageConfig>;
  memory?: GlobalMemoryConfig;
  oAuthSSOProviders?: string[];
  systemAgent?: PartialDeep<UserSystemAgentConfig>;
  telemetry: {
    langfuse?: boolean;
  };
  visualUnderstanding?: VisualUnderstandingConfig;
}

export interface GlobalBillboardItemLocaleFields {
  description?: string;
  linkLabel?: string;
  title?: string;
}

export interface GlobalBillboardItem {
  cover?: string | null;
  description: string;
  /**
   * Override copy per locale. Falls back to the default fields when the locale or a field within it is missing.
   */
  i18n?: Record<string, GlobalBillboardItemLocaleFields>;
  id: number;
  linkLabel?: string | null;
  linkUrl?: string | null;
  title: string;
}

export interface GlobalBillboardLocaleFields {
  title?: string;
}

export interface GlobalBillboard {
  endAt: string;
  /**
   * Override billboard-level fields per locale (currently only title). Falls back to the default title when missing.
   */
  i18n?: Record<string, GlobalBillboardLocaleFields>;
  id: number;
  items: GlobalBillboardItem[];
  slug: string;
  startAt: string;
  title: string;
}

export interface GlobalRuntimeConfig {
  billboard?: GlobalBillboard | null;
  serverConfig: GlobalServerConfig;
  serverFeatureFlags: IFeatureFlagsState;
}

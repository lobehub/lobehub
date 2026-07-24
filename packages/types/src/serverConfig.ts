import type { PartialDeep } from 'type-fest';

import type { ChatModelCard } from './llm';
import type {
  GlobalLLMProviderKey,
  UserDefaultAgent,
  UserImageConfig,
  UserServiceModelConfig,
} from './user/settings';

/**
 * Resolved server feature flags, keyed for the client. The canonical mapping
 * lives in `@lobechat/app-config`'s `mapFeatureFlagsEnvToState`, whose explicit
 * return-type annotation pins it to this interface — add a flag there and the
 * compiler forces the field to be added here (and vice versa).
 *
 * Deliberately a `type` alias: aliases carry an implicit index signature, so
 * existing `as Record<string, unknown>` conversions keep compiling.
 */
export type IFeatureFlagsState = {
  enableAgentOnboarding: boolean | undefined;
  enableAgentSelfIteration: boolean | undefined;
  enableAuthCaptcha: boolean | undefined;
  enableCheckUpdates: boolean | undefined;
  enableKnowledgeBase: boolean | undefined;
  enableRAGEval: boolean | undefined;
  enableSTT: boolean | undefined;
  enableStorageOverage: boolean | undefined;
  enableWorkspace: boolean | undefined;
  hideDocs: boolean | undefined;
  hideGitHub: boolean | undefined;
  isAgentEditable: boolean | undefined;
  showAiImage: boolean | undefined;
  showApiKeyManage: boolean | undefined;
  showChangelog: boolean | undefined;
  showCloudPromotion: boolean | undefined;
  showMarket: boolean | undefined;
  showOpenAIApiKey: boolean | undefined;
  showOpenAIProxyUrl: boolean | undefined;
  showProvider: boolean | undefined;
  showWelcomeSuggest: boolean | undefined;
};

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
  enableComposio?: boolean;
  /**
   * @deprecated
   */
  enabledOAuthSSO?: boolean;
  enableEmailVerification?: boolean;
  /**
   * Whether Gateway mode is available for app-level agent execution.
   */
  enableGatewayMode?: boolean;
  enableLobehubSkill?: boolean;
  enableMagicLink?: boolean;
  enableMarketTrustedClient?: boolean;
  enableUploadFileToServer?: boolean;
  enableVisualUnderstanding?: boolean;
  image?: PartialDeep<UserImageConfig>;
  memory?: GlobalMemoryConfig;
  oAuthSSOProviders?: string[];
  systemAgent?: PartialDeep<UserServiceModelConfig>;
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

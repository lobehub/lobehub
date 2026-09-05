import type { AiFullModelCard } from 'model-bank';
import type { PartialDeep } from 'type-fest';

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
  /**
   * Agent Share capability: may this user publish an Agent as a shared link AND
   * open/chat on an already-live shared agent. One allowlist gates both sides.
   */
  enableAgentShare: boolean | undefined;
  enableAuthCaptcha: boolean | undefined;
  enableCheckUpdates: boolean | undefined;
  enableDevDock: boolean | undefined;
  enableKnowledgeBase: boolean | undefined;
  enableOnboardingV2: boolean | undefined;
  enableRAGEval: boolean | undefined;
  enableSTT: boolean | undefined;
  enableStorageOverage: boolean | undefined;
  enableVoiceDictation: boolean | undefined;
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

export interface MultimodalUnderstandingConfig {
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
  serverModelLists?: AiFullModelCard[];
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
  enableMultimodalUnderstanding?: boolean;
  enableUploadFileToServer?: boolean;
  image?: PartialDeep<UserImageConfig>;
  memory?: GlobalMemoryConfig;
  multimodalUnderstanding?: MultimodalUnderstandingConfig;
  oAuthSSOProviders?: string[];
  systemAgent?: PartialDeep<UserServiceModelConfig>;
  telemetry: {
    langfuse?: boolean;
  };
  /**
   * `TOOL_NAME_MAX_LENGTH`: the length at which a function-call tool name gets
   * compressed to an opaque `MD5HASH_…`, `0` disabling that compression.
   * Exposed to the client because the client-driven chat path builds the tool
   * payload in the browser, where the server env isn't visible — without this
   * the var would only take effect in gateway (server-run) mode.
   * Undefined means "not configured": the default (64) applies.
   */
  toolNameMaxLength?: number;
}

export interface GlobalBillboardItemLocaleFields {
  description?: string;
  linkLabel?: string;
  title?: string;
}

export interface GlobalBillboardItem {
  /**
   * In-app action enum as delivered by the platform (unvalidated string).
   * The client narrows it at runtime against the registry in
   * `src/features/Billboard/actions.ts`; unrecognized values fall back to `linkUrl`.
   */
  action?: string | null;
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

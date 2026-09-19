import type { ModelExtendParams } from '@lobechat/model-runtime/utils/modelExtendParams';
import type { LobeAgentChatConfig } from '@lobechat/types';
import type { AiModelReasoningConfig, ModelAbilities } from 'model-bank';

/** The subset of a model card the rules read (bundled bank or user-enabled list). */
export interface ModelCardFacts {
  abilities?: ModelAbilities | null;
  /** Deployment alias some providers address the model by. */
  deploymentName?: string | null;
  displayName?: string | null;
  extendParams?: string[] | null;
  id: string;
  knowledgeCutoff?: string | null;
  providerId: string;
}

/** The user's own row for the model, when they edited or created one. */
export interface UserModelRowFacts {
  /** Stored as untyped JSON; a non-empty object replaces the card's abilities. */
  abilities?: unknown;
  displayName?: string | null;
  /** `[]` is an explicit opt-out from the card's params; absent falls back to the cards. */
  extendParams?: string[] | null;
}

/** The reasoning config a topic pinned at creation, with the model it was pinned for. */
export interface TopicReasoningPinFacts {
  agentId?: string | null;
  groupId?: string | null;
  model?: string | null;
  provider?: string | null;
  reasoningConfig?: AiModelReasoningConfig | null;
}

export type MediaCapabilities = Pick<ModelAbilities, 'audio' | 'video' | 'vision'>;

/** Everything the model-parameter rules read about the run. */
export interface ModelParamsRequest {
  agent: {
    chatConfig?: LobeAgentChatConfig | null;
    id?: string;
    /** Raw sub-agent chatConfig patch; explicit reasoning fields here win. */
    subAgentChatConfigOverride?: Partial<LobeAgentChatConfig> | null;
  };
  /**
   * Media capabilities frozen when the operation was created, for exactly
   * `model` / `provider`. Preferred over a live lookup so retries and settings
   * edits cannot change what the run already discovered.
   */
  mediaCapabilities?: MediaCapabilities;
  model: string;
  provider: string;
  searchDecision?: { enabledSearch?: boolean; useModelSearch?: boolean };
  topicId?: string;
}

/**
 * How a host fetches model facts. Cards are synchronous (both hosts hold the
 * bank in memory); the user row, the reasoning config and the topic pin are
 * lookups the rules only make when the model can consume the result.
 */
export interface ModelParamsProviders {
  /** The topic's reasoning pin. Share-visitor topics must be readable too. */
  findTopicReasoningPin?: (topicId: string) => Promise<TopicReasoningPinFacts | null | undefined>;
  /** The user's model-instance reasoning config (personal scope). */
  getModelReasoningConfig?: (
    model: string,
    provider: string,
  ) => Promise<AiModelReasoningConfig | null | undefined>;
  getUserModelRow?: (
    model: string,
    provider: string,
  ) => Promise<UserModelRowFacts | null | undefined>;
  /** Every model card the host knows; the rules match by provider / id / deployment name. */
  listModelCards: () => ModelCardFacts[];
}

export interface ResolvedModelExtendParamList {
  /** Card matched by id across any provider (aggregation fallback). */
  canonicalModelCard?: ModelCardFacts;
  /** Card for exactly `provider` / `model`. */
  modelCard?: ModelCardFacts;
  /** Effective extend params: user row → provider card → canonical card. */
  modelExtendParams?: string[];
  /** True when any effort-family / reasoningMode param is among `modelExtendParams`. */
  modelHasReasoningExtendParams: boolean;
  userModelRow?: UserModelRowFacts;
}

export interface ResolvedModelParams extends ResolvedModelExtendParamList {
  capabilities: {
    isCanUseAudio: (model: string, provider: string) => boolean;
    isCanUseFC: (model: string, provider: string) => boolean;
    isCanUseVideo: (model: string, provider: string) => boolean;
    isCanUseVision: (model: string, provider: string) => boolean;
  };
  /** The agent's stored mode, untouched: a model without function calling keeps it. */
  enableAgentMode?: boolean;
  /** History window incl. the current turn; undefined = no truncation. */
  historyCount?: number;
  modelDisplayName?: string;
  modelKnowledgeCutoff?: string;
  preserveThinkingForPayload?: boolean;
  resolvedExtendParams?: ModelExtendParams & { enabledSearch?: boolean };
  shouldReplayAssistantReasoning: boolean;
  /** Whether the LLM call streams, from the agent's chat config. */
  stream: boolean;
}

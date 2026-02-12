import type {
  GenerateObjectPayload,
  ModelRuntime,
  OpenAIChatMessage,
} from '@lobechat/model-runtime';
import type { LayersEnum, MemorySourceType } from '@lobechat/types';

import type {
  ActivityExtractor,
  ContextExtractor,
  ExperienceExtractor,
  IdentityExtractor,
  PreferenceExtractor,
} from './extractors';

export type MemoryExtractionAgent =
  | 'gatekeeper'
  | 'layer-activity'
  | 'layer-context'
  | 'layer-experience'
  | 'layer-identity'
  | 'layer-preference'
  | 'user-persona';

export interface ExtractorRunOptions<RO> extends ExtractorOptions {
  contextProvider: MemoryContextProvider<{ topK?: number }>;
  existingIdentitiesContext?: string;
  gatekeeperLanguage?: string;
  resultRecorder?: MemoryResultRecorder<RO>;
}

export interface ExtractorOptions extends ExtractorTemplateProps {
  additionalMessages?: OpenAIChatMessage[];
  callbacks?: {
    onExtractError?: (agent: MemoryExtractionAgent, error: unknown) => Promise<void> | void;
    onExtractRequest?: (
      agent: MemoryExtractionAgent,
      request: GenerateObjectPayload,
    ) => Promise<void> | void;
    onExtractResponse?: <TOutput>(
      agent: MemoryExtractionAgent,
      response: TOutput,
    ) => Promise<void> | void;
  };
  messageIds?: string[];
  sourceId?: string;
  userId?: string;
}

export interface ExtractorTemplateProps {
  availableCategories?: string[];
  language?: string;
  retrievedContexts?: string[];
  retrievedIdentitiesContext?: string;
  sessionDate?: string;
  topK?: number;
  username?: string;
}

export interface GatekeeperTemplateProps extends ExtractorTemplateProps {
  gateKeeperLanguage?: string;
}

export type GatekeeperOptions = Pick<ExtractorOptions, 'retrievedContexts' | 'topK'> & {
  additionalMessages?: OpenAIChatMessage[];
  callbacks?: ExtractorOptions['callbacks'];
  gateKeeperLanguage?: string;
};

export interface BaseExtractorDependencies {
  agent: MemoryExtractionAgent;
  model: string;
  modelRuntime: ModelRuntime;
}

export interface MemoryExtractionLLMConfig {
  embeddingsModel?: string;
  gateModel: string;
  layerModels: Partial<Record<LayersEnum, string>>;
  provider?: string;
}

export interface MemoryExtractionJob {
  force?: boolean;
  layers?: LayersEnum[];
  source: MemorySourceType;
  sourceId: string;
  sourceUpdatedAt?: Date;
  userId: string;
}

export interface MemoryExtractionSourceMetadata {
  error?: string;
  lastConversationDigest?: string;
  lastProcessedAt?: string;
  lastProcessedMessageId?: string;
  status?: 'pending' | 'completed' | 'failed';
  version?: string;
}

export type ContextOptions<P extends Record<string, unknown>> = P;

export interface BuiltContext<T = Record<string, unknown>> {
  context: string;
  metadata: T;
  sourceId: string;
  userId: string;
}

export interface MemoryContextProvider<
  P extends Record<string, unknown> = Record<string, unknown>,
  R extends Record<string, unknown> = Record<string, unknown>,
> {
  buildContext: (userId: string, sourceId: string, options?: P) => Promise<BuiltContext<R>>;
}

export interface MemoryResultRecorder<T = Record<string, unknown>> {
  recordComplete: (job: MemoryExtractionJob, result: PersistedMemoryResult & T) => Promise<void>;
  recordFail?: (job: MemoryExtractionJob, error: Error) => Promise<void>;
}

export interface PersistedMemoryResult {
  createdIds: string[];
  layers: Partial<Record<LayersEnum, number>>;
}

export type MemoryExtractionLayerOutputs = Partial<{
  activity: {
    data?: Awaited<ReturnType<ActivityExtractor['structuredCall']>>;
    error?: unknown;
  };
  context: {
    data?: Awaited<ReturnType<ContextExtractor['structuredCall']>>;
    error?: unknown;
  };
  experience: {
    data?: Awaited<ReturnType<ExperienceExtractor['structuredCall']>>;
    error?: unknown;
  };
  identity: {
    data?: Awaited<ReturnType<IdentityExtractor['structuredCall']>>;
    error?: unknown;
  };
  preference: {
    data?: Awaited<ReturnType<PreferenceExtractor['structuredCall']>>;
    error?: unknown;
  };
}>;

export interface GatekeeperDecision {
  activity: MemoryLayerDecision;
  context: MemoryLayerDecision;
  experience: MemoryLayerDecision;
  identity: MemoryLayerDecision;
  preference: MemoryLayerDecision;
}

export interface MemoryLayerDecision {
  reasoning: string;
  shouldExtract: boolean;
}

export interface MemoryExtractionResult {
  decision: GatekeeperDecision;
  inputs: {
    retrievedContexts?: string[];
    retrievedIdentitiesContext?: string;
  };
  layers: LayersEnum[];
  outputs: MemoryExtractionLayerOutputs;
  processedCounts: number;
  processedErrorsCount: Record<LayersEnum, number>;
  processedLayersCount: Record<LayersEnum, number>;
}

export interface TemplateProps {
  [key: string]: unknown;
}

export interface PersonaTemplateProps extends ExtractorTemplateProps {
  existingPersona?: string;
  personaNotes?: string;
  recentEvents?: string;
  retrievedMemories?: string;
  userProfile?: string;
}

export interface PersonaExtractorOptions extends ExtractorOptions, PersonaTemplateProps {}

export interface UserPersonaExtractionResult {
  diff?: string | null;
  memoryIds?: string[];
  persona: string;
  reasoning?: string | null;
  sourceIds?: string[];
  tagline?: string | null;
}

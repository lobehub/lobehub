import type { MemorySourceType } from './list';
import type { LayersEnum } from './shared';

export type MemoryExtractionAgent =
  | 'gatekeeper'
  | 'layer-activity'
  | 'layer-context'
  | 'layer-experience'
  | 'layer-identity'
  | 'layer-preference';

export interface MemoryExtractionTraceError {
  message: string;
  name?: string;
  stack?: string;
}

export interface MemoryExtractionAgentCallTrace<TRequest = unknown, TResponse = unknown> {
  durationMs?: number;
  error?: MemoryExtractionTraceError;
  request?: TRequest;
  response?: TResponse;
}

export interface MemoryExtractionTraceBuiltContexts {
  retrievalMemoryContext?: unknown;
  retrievedIdentityContext?: unknown;
  topicContext?: unknown;
}

export interface MemoryExtractionTraceTrimmedContexts {
  retrievedContexts?: string[];
  retrievedIdentitiesContext?: string;
}

export interface MemoryExtractionTraceContexts {
  built?: MemoryExtractionTraceBuiltContexts;
  trimmed?: MemoryExtractionTraceTrimmedContexts;
}

export interface MemoryExtractionTraceJob {
  force?: boolean;
  layers?: LayersEnum[];
  source: MemorySourceType;
  sourceId: string;
  sourceUpdatedAt?: string | Date;
  userId: string;
}

export interface MemoryExtractionTracePersistedResult {
  createdIds: string[];
  layers: Partial<Record<LayersEnum, number>>;
}

export interface MemoryExtractionTraceMemories {
  identities?: unknown;
  layers?: unknown;
}

export interface MemoryExtractionTraceSource {
  chatTopic?: {
    conversations?: unknown;
    topic?: unknown;
  };
}

export interface MemoryExtractionTraceResult<TExtraction = unknown> {
  extraction?: TExtraction | null;
  persisted?: MemoryExtractionTracePersistedResult | null;
}

export interface MemoryExtractionTracePayload<
  TExtraction = unknown,
  TJob extends MemoryExtractionTraceJob | null = MemoryExtractionTraceJob | null,
  TRequest = unknown,
  TResponse = unknown,
> {
  agentCalls: Partial<
    Record<MemoryExtractionAgent, MemoryExtractionAgentCallTrace<TRequest, TResponse>>
  >;
  contexts?: MemoryExtractionTraceContexts;
  error?: MemoryExtractionTraceError;
  extractionJob?: TJob;
  memories?: MemoryExtractionTraceMemories;
  result?: MemoryExtractionTraceResult<TExtraction>;
  source?: MemoryExtractionTraceSource;
  sourceType?: MemorySourceType;
  userId?: string;
  userState?: unknown;
}

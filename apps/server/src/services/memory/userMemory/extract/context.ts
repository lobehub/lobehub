import type { OpenAIChatMessage } from '@lobechat/model-runtime';

import type { getServerDB } from '@/database/server';
import type { ProviderConfig } from '@/types/user/settings';

import type { countTokens, generateEmbeddings, trimTextToTokenLimit } from './embeddings';
import type {
  getOnExtractHooksPath,
  reportUserInitiatedProgress,
  uploadExtractionTrace,
} from './extractTopic';
import type {
  normalizeLayerError,
  persistExtraction,
  recordJobMetrics,
  recordLayerEntries,
} from './persistExtraction';
import type {
  buildBaseMetadata,
  persistActivityMemories,
  persistContextMemories,
  persistExperienceMemories,
  persistIdentityMemories,
  persistPreferenceMemories,
} from './persistLayers';
import type {
  listConversationsForTopic,
  listRelevantUserMemories,
  listUserMemoryIdentities,
} from './queries';
import type {
  getAiProviderRuntimeState,
  getRuntime,
  resolveRuntimeKeyVaults,
  resolveUserMemoryAgent,
  resolveUserMemoryServiceConfig,
} from './runtime';
import type { MemoryExtractionConfig, MemoryExtractionModelConfig, RuntimeBundle } from './types';

type OmitContext<F> = F extends (ctx: MemoryExtractionExecutorContext, ...args: infer A) => infer R
  ? (...args: A) => R
  : never;

/**
 * What the extracted `MemoryExtractionExecutor` modules read from the executor. Fields are getters
 * and methods dispatch through the instance, so spies on executor methods still apply.
 */
export interface MemoryExtractionExecutorContext {
  readonly aiProviderConfig: Record<string, ProviderConfig>;
  buildBaseMetadata: typeof buildBaseMetadata;
  countTokens: typeof countTokens;
  readonly db: ReturnType<typeof getServerDB>;
  readonly embeddingPreferredModels: string[] | undefined;
  readonly embeddingPreferredProviders: string[] | undefined;
  readonly gatekeeperPreferredModels: string[] | undefined;
  readonly gatekeeperPreferredProviders: string[] | undefined;
  generateEmbeddings: typeof generateEmbeddings;
  getAiProviderRuntimeState: OmitContext<typeof getAiProviderRuntimeState>;
  getOnExtractHooksPath: OmitContext<typeof getOnExtractHooksPath>;
  getRuntime: OmitContext<typeof getRuntime>;
  readonly layerPreferredModels: string[] | undefined;
  readonly layerPreferredProviders: string[] | undefined;
  listConversationsForTopic: OmitContext<typeof listConversationsForTopic>;
  listRelevantUserMemories: OmitContext<typeof listRelevantUserMemories>;
  listUserMemoryIdentities: OmitContext<typeof listUserMemoryIdentities>;
  readonly modelConfig: MemoryExtractionModelConfig;
  normalizeLayerError: typeof normalizeLayerError;
  persistActivityMemories: OmitContext<typeof persistActivityMemories>;
  persistContextMemories: OmitContext<typeof persistContextMemories>;
  persistExperienceMemories: OmitContext<typeof persistExperienceMemories>;
  persistExtraction: OmitContext<typeof persistExtraction>;
  persistIdentityMemories: OmitContext<typeof persistIdentityMemories>;
  persistPreferenceMemories: OmitContext<typeof persistPreferenceMemories>;
  readonly privateConfig: MemoryExtractionConfig;
  recordJobMetrics: typeof recordJobMetrics;
  recordLayerEntries: typeof recordLayerEntries;
  reportUserInitiatedProgress: OmitContext<typeof reportUserInitiatedProgress>;
  resolveRuntimeKeyVaults: OmitContext<typeof resolveRuntimeKeyVaults>;
  resolveUserMemoryAgent: typeof resolveUserMemoryAgent;
  resolveUserMemoryServiceConfig: OmitContext<typeof resolveUserMemoryServiceConfig>;
  readonly runtimeCache: Map<string, RuntimeBundle>;
  trimConversationsToTokenLimit: <T extends OpenAIChatMessage>(
    conversations: (T & { createdAt: Date })[],
    tokenLimit?: number,
  ) => Promise<(T & { createdAt: Date })[]>;
  trimTextToTokenLimit: typeof trimTextToTokenLimit;
  uploadExtractionTrace: OmitContext<typeof uploadExtractionTrace>;
}

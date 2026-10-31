import { DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM } from '@lobechat/const';
import type {
  BenchmarkLocomoContextProvider,
  BenchmarkLocomoPart,
  MemoryExtractionJob,
  MemoryExtractionResult,
  PersistedMemoryResult,
} from '@lobechat/memory-user-memory';
import type {
  GenerateObjectPayload,
  ModelRuntime,
  OpenAIChatMessage,
} from '@lobechat/model-runtime';
import type {
  AiProviderRuntimeState,
  IdentityMemoryDetail,
  MemoryExtractionTracePayload,
  UserServiceModelConfig,
} from '@lobechat/types';

import type { ListTopicsForMemoryExtractorCursor } from '@/database/models/topic';
import type { ListUsersForMemoryExtractorCursor } from '@/database/models/user';
import type { UserMemoryHybridSearchAggregatedResult } from '@/database/models/userMemory';
import { UserMemorySourceBenchmarkLoCoMoModel } from '@/database/models/userMemory/sources/benchmarkLoCoMo';
import { getServerDB } from '@/database/server';
import { getServerGlobalConfig } from '@/server/globalConfig';
import type { MemoryAgentConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import type { S3 } from '@/server/modules/S3';
import type { ProviderConfig } from '@/types/user/settings';
import type { LayersEnum } from '@/types/userMemory';
import { MemorySourceType } from '@/types/userMemory';

import { extractBenchmarkSource } from './benchmark';
import type { MemoryExtractionExecutorContext } from './context';
import {
  countTokens,
  generateEmbeddings,
  trimConversationsToTokenLimit,
  trimTextToTokenLimit,
} from './embeddings';
import {
  extractTopic,
  getOnExtractHooksPath,
  reportUserInitiatedProgress,
  uploadExtractionTrace,
} from './extractTopic';
import type { MemoryExtractionNormalizedPayload } from './payload';
import {
  normalizeLayerError,
  persistExtraction,
  recordJobMetrics,
  recordLayerEntries,
} from './persistExtraction';
import {
  buildBaseMetadata,
  persistActivityMemories,
  persistContextMemories,
  persistExperienceMemories,
  persistIdentityMemories,
  persistPreferenceMemories,
} from './persistLayers';
import {
  filterTopicIdsForUser,
  getTopicsForUser,
  getUsers,
  getUsersForHourlyExtraction,
  listConversationsForTopic,
  listRelevantUserMemories,
  listUserMemoryIdentities,
} from './queries';
import type { ProviderKeyVaultMap } from './runtime';
import {
  getAiProviderRuntimeState,
  getRuntime,
  resolveLayerModels,
  resolveRuntimeKeyVaults,
  resolveUserMemoryAgent,
  resolveUserMemoryServiceConfig,
} from './runtime';
import type {
  MemoryExtractionConfig,
  MemoryExtractionModelConfig,
  ResolvedMemoryServiceConfig,
  RuntimeBundle,
  ServerConfig,
  TopicExtractionJob,
  TopicPaginationJob,
  UserPaginationResult,
} from './types';

export { makeTaskErrorItem } from './errors';
export type {
  MemoryExtractionHourlyWorkflowPayload,
  MemoryExtractionNormalizedPayload,
  MemoryExtractionPayloadInput,
  MemoryExtractionWorkflowCursor,
  TopicBatchWorkflowPayload,
  TopicWorkflowCursor,
  UserTopicWorkflowPayload,
} from './payload';
export {
  buildWorkflowPayloadInput,
  memoryExtractionPayloadSchema,
  normalizeMemoryExtractionPayload,
} from './payload';
export type { ProviderCredential, ProviderKeyVaultMap, RuntimeResolveOptions } from './runtime';
export { resolveRuntimeAgentConfig } from './runtime';
export type { TopicExtractionJob, TopicPaginationJob, UserPaginationResult } from './types';
export { MemoryExtractionWorkflowService } from './workflow';

export class MemoryExtractionExecutor {
  private readonly aiProviderConfig: Record<string, ProviderConfig>;
  private readonly embeddingPreferredModels?: string[];
  private readonly embeddingPreferredProviders?: string[];
  private readonly gatekeeperPreferredModels?: string[];
  private readonly gatekeeperPreferredProviders?: string[];
  private readonly layerPreferredModels?: string[];
  private readonly layerPreferredProviders?: string[];
  private readonly privateConfig: MemoryExtractionConfig;
  private readonly modelConfig: MemoryExtractionModelConfig;
  private readonly runtimeCache = new Map<string, RuntimeBundle>();
  private readonly db = getServerDB();
  private readonly context: MemoryExtractionExecutorContext;

  private constructor(serverConfig: ServerConfig, privateConfig: MemoryExtractionConfig) {
    this.privateConfig = privateConfig;
    this.aiProviderConfig = (serverConfig.aiProvider || {}) as Record<string, ProviderConfig>;
    this.embeddingPreferredProviders = privateConfig.embeddingPreferredProviders;
    this.embeddingPreferredModels = privateConfig.embeddingPreferredModels;
    this.gatekeeperPreferredProviders = privateConfig.agentGateKeeperPreferredProviders;
    this.gatekeeperPreferredModels = privateConfig.agentGateKeeperPreferredModels;
    this.layerPreferredProviders = privateConfig.agentLayerExtractorPreferredProviders;
    this.layerPreferredModels = privateConfig.agentLayerExtractorPreferredModels;

    const publicMemoryConfig = serverConfig.memory?.userMemory;

    this.modelConfig = {
      embeddingsModel:
        publicMemoryConfig?.embedding?.model ??
        privateConfig.embedding?.model ??
        privateConfig.agentLayerExtractor.model ??
        DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM.model,
      gateModel: publicMemoryConfig?.agentGateKeeper?.model ?? privateConfig.agentGateKeeper.model,
      layerModels: resolveLayerModels(
        publicMemoryConfig?.agentLayerExtractor.layers,
        privateConfig.agentLayerExtractor.layers,
      ),
      observabilityS3: privateConfig.observabilityS3,
    };

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const executor = this;
    this.context = {
      get aiProviderConfig() {
        return executor.aiProviderConfig;
      },
      get db() {
        return executor.db;
      },
      get embeddingPreferredModels() {
        return executor.embeddingPreferredModels;
      },
      get embeddingPreferredProviders() {
        return executor.embeddingPreferredProviders;
      },
      get gatekeeperPreferredModels() {
        return executor.gatekeeperPreferredModels;
      },
      get gatekeeperPreferredProviders() {
        return executor.gatekeeperPreferredProviders;
      },
      get layerPreferredModels() {
        return executor.layerPreferredModels;
      },
      get layerPreferredProviders() {
        return executor.layerPreferredProviders;
      },
      get modelConfig() {
        return executor.modelConfig;
      },
      get privateConfig() {
        return executor.privateConfig;
      },
      get runtimeCache() {
        return executor.runtimeCache;
      },
      buildBaseMetadata: (...args) => this.buildBaseMetadata(...args),
      countTokens: (...args) => this.countTokens(...args),
      generateEmbeddings: (...args) => this.generateEmbeddings(...args),
      getAiProviderRuntimeState: (...args) => this.getAiProviderRuntimeState(...args),
      getOnExtractHooksPath: (...args) => this.getOnExtractHooksPath(...args),
      getRuntime: (...args) => this.getRuntime(...args),
      listConversationsForTopic: (...args) => this.listConversationsForTopic(...args),
      listRelevantUserMemories: (...args) => this.listRelevantUserMemories(...args),
      listUserMemoryIdentities: (...args) => this.listUserMemoryIdentities(...args),
      normalizeLayerError: (...args) => this.normalizeLayerError(...args),
      persistActivityMemories: (...args) => this.persistActivityMemories(...args),
      persistContextMemories: (...args) => this.persistContextMemories(...args),
      persistExperienceMemories: (...args) => this.persistExperienceMemories(...args),
      persistExtraction: (...args) => this.persistExtraction(...args),
      persistIdentityMemories: (...args) => this.persistIdentityMemories(...args),
      persistPreferenceMemories: (...args) => this.persistPreferenceMemories(...args),
      recordJobMetrics: (...args) => this.recordJobMetrics(...args),
      recordLayerEntries: (...args) => this.recordLayerEntries(...args),
      reportUserInitiatedProgress: (...args) => this.reportUserInitiatedProgress(...args),
      resolveRuntimeKeyVaults: (...args) => this.resolveRuntimeKeyVaults(...args),
      resolveUserMemoryAgent: (...args) => this.resolveUserMemoryAgent(...args),
      resolveUserMemoryServiceConfig: (...args) => this.resolveUserMemoryServiceConfig(...args),
      trimConversationsToTokenLimit: (...args) => this.trimConversationsToTokenLimit(...args),
      trimTextToTokenLimit: (...args) => this.trimTextToTokenLimit(...args),
      uploadExtractionTrace: (...args) => this.uploadExtractionTrace(...args),
    };
  }

  static async create() {
    const [serverConfig, privateConfig] = await Promise.all([
      getServerGlobalConfig(),
      Promise.resolve(parseMemoryExtractionConfig()),
    ]);

    return new MemoryExtractionExecutor(serverConfig, privateConfig);
  }

  private resolveUserMemoryAgent(
    systemAgent: Partial<UserServiceModelConfig> | undefined,
    key: keyof Pick<
      UserServiceModelConfig,
      'userMemoryEmbedding' | 'memoryAnalysisAgentConfig' | 'userMemoryPersonaWriter'
    >,
    fallback: MemoryAgentConfig,
  ): MemoryAgentConfig {
    return resolveUserMemoryAgent(systemAgent, key, fallback);
  }

  private resolveUserMemoryServiceConfig(
    systemAgent?: Partial<UserServiceModelConfig>,
  ): ResolvedMemoryServiceConfig {
    return resolveUserMemoryServiceConfig(this.context, systemAgent);
  }

  private buildBaseMetadata(
    job: MemoryExtractionJob,
    messageIds: string[],
    layer: LayersEnum,
    labels?: string[] | null,
  ) {
    return buildBaseMetadata(job, messageIds, layer, labels);
  }

  private async countTokens(text: string) {
    return countTokens(text);
  }

  private async trimTextToTokenLimit(text: string, tokenLimit?: number) {
    return trimTextToTokenLimit(text, tokenLimit);
  }

  private async trimConversationsToTokenLimit<T extends OpenAIChatMessage>(
    conversations: (T & { createdAt: Date })[],
    tokenLimit?: number,
  ) {
    return trimConversationsToTokenLimit(this.context, conversations, tokenLimit);
  }

  private async generateEmbeddings(
    runtimes: ModelRuntime,
    model: string,
    texts: Array<string | undefined | null>,
    userId: string,
    tokenLimit?: number,
  ) {
    return generateEmbeddings(runtimes, model, texts, userId, tokenLimit);
  }

  async persistActivityMemories(
    job: MemoryExtractionJob,
    messageIds: string[],
    result: NonNullable<MemoryExtractionResult['outputs']['activity']>['data'],
    runtime: ModelRuntime,
    model: string,
    tokenLimit: number | undefined,
    db: Awaited<ReturnType<typeof getServerDB>>,
  ) {
    return persistActivityMemories(
      this.context,
      job,
      messageIds,
      result,
      runtime,
      model,
      tokenLimit,
      db,
    );
  }

  async persistContextMemories(
    job: MemoryExtractionJob,
    messageIds: string[],
    result: NonNullable<MemoryExtractionResult['outputs']['context']>['data'],
    runtime: ModelRuntime,
    model: string,
    tokenLimit: number | undefined,
    db: Awaited<ReturnType<typeof getServerDB>>,
  ) {
    return persistContextMemories(
      this.context,
      job,
      messageIds,
      result,
      runtime,
      model,
      tokenLimit,
      db,
    );
  }

  async persistExperienceMemories(
    job: MemoryExtractionJob,
    messageIds: string[],
    result: NonNullable<MemoryExtractionResult['outputs']['experience']>['data'],
    runtime: ModelRuntime,
    model: string,
    tokenLimit: number | undefined,
    db: Awaited<ReturnType<typeof getServerDB>>,
  ) {
    return persistExperienceMemories(
      this.context,
      job,
      messageIds,
      result,
      runtime,
      model,
      tokenLimit,
      db,
    );
  }

  async persistPreferenceMemories(
    job: MemoryExtractionJob,
    messageIds: string[],
    result: NonNullable<MemoryExtractionResult['outputs']['preference']>['data'],
    runtime: ModelRuntime,
    model: string,
    tokenLimit: number | undefined,
    db: Awaited<ReturnType<typeof getServerDB>>,
  ) {
    return persistPreferenceMemories(
      this.context,
      job,
      messageIds,
      result,
      runtime,
      model,
      tokenLimit,
      db,
    );
  }

  async persistIdentityMemories(
    job: MemoryExtractionJob,
    messageIds: string[],
    result: NonNullable<MemoryExtractionResult['outputs']['identity']>['data'],
    runtime: ModelRuntime,
    model: string,
    tokenLimit: number | undefined,
    db: Awaited<ReturnType<typeof getServerDB>>,
  ) {
    return persistIdentityMemories(
      this.context,
      job,
      messageIds,
      result,
      runtime,
      model,
      tokenLimit,
      db,
    );
  }

  async listConversationsForTopic(
    userId: string,
    topicId: string,
    topicUpdatedAt: Date,
    workspaceId?: string,
  ) {
    return listConversationsForTopic(this.context, userId, topicId, topicUpdatedAt, workspaceId);
  }

  async listRelevantUserMemories(
    job: MemoryExtractionJob,
    runtime: ModelRuntime,
    embeddingModel: string,
    userId: string,
    conversations: OpenAIChatMessage[],
    tokenLimit?: number,
  ): Promise<UserMemoryHybridSearchAggregatedResult> {
    return listRelevantUserMemories(
      this.context,
      job,
      runtime,
      embeddingModel,
      userId,
      conversations,
      tokenLimit,
    );
  }

  async listUserMemoryIdentities(
    job: MemoryExtractionJob,
    userId: string,
  ): Promise<IdentityMemoryDetail[]> {
    return listUserMemoryIdentities(this.context, job, userId);
  }

  private async reportUserInitiatedProgress(job: TopicExtractionJob) {
    return reportUserInitiatedProgress(this.context, job);
  }

  async extractTopic(job: TopicExtractionJob) {
    return extractTopic(this.context, job);
  }

  private getOnExtractHooksPath(
    userId: string,
    source: string,
    sourceId: string,
  ): string | undefined {
    return getOnExtractHooksPath(this.context, userId, source, sourceId);
  }

  private async uploadExtractionTrace(
    payload: MemoryExtractionTracePayload<
      MemoryExtractionResult,
      MemoryExtractionJob | null,
      GenerateObjectPayload
    >,
    userId: string,
    source: string,
    sourceId: string,
    s3: S3,
  ) {
    return uploadExtractionTrace(this.context, payload, userId, source, sourceId, s3);
  }

  async runDirect(payload: MemoryExtractionNormalizedPayload) {
    if (!payload.userIds.length) {
      throw new Error('Direct execution requires at least one user id.');
    }

    const results: {
      extracted: boolean;
      layers: Record<string, number>;
      memoryIds: string[];
      topicId: string;
      userId: string;
    }[] = [];

    const includesChatTopic = payload.sources.includes(MemorySourceType.ChatTopic);
    const includesBenchmark = payload.sources.includes(MemorySourceType.BenchmarkLocomo);

    if (includesChatTopic) {
      if (!payload.topicIds.length) {
        throw new Error('Direct chat_topic execution requires topicIds.');
      }

      for (const userId of payload.userIds) {
        const topicIds = await this.filterTopicIdsForUser(
          userId,
          payload.topicIds,
          payload.workspaceId,
        );
        for (const topicId of topicIds) {
          const extracted = await this.extractTopic({
            asyncTaskId: payload.asyncTaskId,
            forceAll: payload.forceAll,
            forceTopics: payload.forceTopics,
            from: payload.from,
            layers: payload.layers,
            source: MemorySourceType.ChatTopic,
            to: payload.to,
            topicId,
            userId,
            userInitiated: payload.userInitiated,
            workspaceId: payload.workspaceId,
          });

          results.push({ ...extracted, topicId, userId });
        }
      }
    }

    if (includesBenchmark) {
      const benchmarkSourceIds =
        payload.sourceIds && payload.sourceIds.length > 0 ? payload.sourceIds : payload.topicIds;
      if (!benchmarkSourceIds.length) {
        throw new Error('Direct benchmark_locomo execution requires sourceIds.');
      }

      for (const userId of payload.userIds) {
        const sourceModel = new UserMemorySourceBenchmarkLoCoMoModel(userId);
        for (const sourceId of benchmarkSourceIds) {
          const parts = await sourceModel.listParts(sourceId);
          if (!parts.length) {
            results.push({
              extracted: false,
              layers: {},
              memoryIds: [],
              topicId: sourceId,
              userId,
            });
            continue;
          }

          const extraction = await this.extractBenchmarkSource({
            forceAll: payload.forceAll,
            layers: payload.layers,
            parts: parts as unknown as BenchmarkLocomoPart[],
            source: MemorySourceType.BenchmarkLocomo,
            sourceId,
            userId,
          });

          results.push({ ...extraction, topicId: sourceId, userId });
        }
      }
    }

    return { processed: results.length, results };
  }

  async getTopicsForUser(
    job: TopicPaginationJob,
    pageSize: number,
  ): Promise<{ cursor?: ListTopicsForMemoryExtractorCursor; ids: string[] }> {
    return getTopicsForUser(this.context, job, pageSize);
  }

  async getUsers(
    limit: number,
    cursor?: ListUsersForMemoryExtractorCursor,
  ): Promise<UserPaginationResult> {
    return getUsers(this.context, limit, cursor);
  }

  async getUsersForHourlyExtraction(
    limit: number,
    cursor?: ListUsersForMemoryExtractorCursor,
  ): Promise<UserPaginationResult> {
    return getUsersForHourlyExtraction(this.context, limit, cursor);
  }

  async filterTopicIdsForUser(userId: string, topicIds: string[], workspaceId?: string) {
    return filterTopicIdsForUser(this.context, userId, topicIds, workspaceId);
  }

  private recordJobMetrics(
    job: MemoryExtractionJob,
    status: 'completed' | 'failed',
    durationMs: number,
  ) {
    return recordJobMetrics(job, status, durationMs);
  }

  private recordLayerEntries(job: MemoryExtractionJob, layer: LayersEnum, count: number) {
    return recordLayerEntries(job, layer, count);
  }

  private normalizeLayerError(layer: LayersEnum, stage: 'extract' | 'persist', error: unknown) {
    return normalizeLayerError(layer, stage, error);
  }

  private async persistExtraction(
    job: MemoryExtractionJob,
    messageIds: string[],
    extraction: MemoryExtractionResult,
    runtimes: RuntimeBundle,
    memoryServiceConfig: ResolvedMemoryServiceConfig,
    db: Awaited<ReturnType<typeof getServerDB>>,
  ): Promise<PersistedMemoryResult> {
    return persistExtraction(
      this.context,
      job,
      messageIds,
      extraction,
      runtimes,
      memoryServiceConfig,
      db,
    );
  }

  private async getAiProviderRuntimeState(
    userId: string,
    workspaceId?: string,
  ): Promise<AiProviderRuntimeState> {
    return getAiProviderRuntimeState(this.context, userId, workspaceId);
  }

  private async resolveRuntimeKeyVaults(
    runtimeState: AiProviderRuntimeState,
    memoryServiceConfig: ResolvedMemoryServiceConfig,
  ): Promise<ProviderKeyVaultMap> {
    return resolveRuntimeKeyVaults(this.context, runtimeState, memoryServiceConfig);
  }

  private async getRuntime(
    userId: string,
    memoryServiceConfig: ResolvedMemoryServiceConfig,
    keyVaults?: ProviderKeyVaultMap,
  ): Promise<RuntimeBundle> {
    return getRuntime(this.context, userId, memoryServiceConfig, keyVaults);
  }

  async extractBenchmarkSource(params: {
    contextProvider?: BenchmarkLocomoContextProvider;
    forceAll?: boolean;
    language?: string;
    layers?: LayersEnum[];
    parts: BenchmarkLocomoPart[];
    source: MemorySourceType;
    sourceId: string;
    userId: string;
  }) {
    return extractBenchmarkSource(this.context, params);
  }
}

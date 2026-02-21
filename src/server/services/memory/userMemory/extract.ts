import {
  DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
  DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM,
} from '@lobechat/const';
import { messages, topics } from '@lobechat/database/schemas';
import {
  type BenchmarkLocomoPart,
  type MemoryExtractionAgent,
  type MemoryExtractionJob,
  type MemoryExtractionResult,
  type PersistedMemoryResult,
} from '@lobechat/memory-user-memory';
import {
  BenchmarkLocomoContextProvider,
  LobeChatTopicContextProvider,
  LobeChatTopicResultRecorder,
  MemoryExtractionService,
  RetrievalUserMemoryContextProvider,
  RetrievalUserMemoryIdentitiesProvider,
} from '@lobechat/memory-user-memory';
import {
  type Embeddings,
  type GenerateObjectPayload,
  type LLMRoleType,
  type OpenAIChatMessage,
} from '@lobechat/model-runtime';
import { ModelRuntime } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
} from '@lobechat/observability-otel/gen-ai';
import {
  layerEntriesHistogram,
  processedDurationHistogram,
  processedSourceCounter,
  tracer,
} from '@lobechat/observability-otel/modules/memory-user-memory';
import { attributesCommon } from '@lobechat/observability-otel/node';
import {
  type AiProviderRuntimeState,
  type ChatTopicMetadata,
  type IdentityMemoryDetail,
  type MemoryExtractionAgentCallTrace,
  type MemoryExtractionTraceError,
  type MemoryExtractionTracePayload,
} from '@lobechat/types';
import { type FlowControl } from '@upstash/qstash';
import { Client } from '@upstash/workflow';
import debug from 'debug';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { join } from 'pathe';
import { z } from 'zod';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { type ListTopicsForMemoryExtractorCursor } from '@/database/models/topic';
import { TopicModel } from '@/database/models/topic';
import { type ListUsersForMemoryExtractorCursor } from '@/database/models/user';
import { UserModel } from '@/database/models/user';
import { UserMemoryModel } from '@/database/models/userMemory';
import { UserMemorySourceBenchmarkLoCoMoModel } from '@/database/models/userMemory/sources/benchmarkLoCoMo';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getServerDB } from '@/database/server';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { type MemoryAgentConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { S3 } from '@/server/modules/S3';
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@/types/asyncTask';
import { type GlobalMemoryLayer } from '@/types/serverConfig';
import { type ProviderConfig } from '@/types/user/settings';
import { type MergeStrategyEnum } from '@/types/userMemory';
import { LayersEnum, MemorySourceType, TypesEnum } from '@/types/userMemory';
import { trimBasedOnBatchProbe } from '@/utils/chunkers';
import { encodeAsync } from '@/utils/tokenizer';

const SOURCE_ALIAS_MAP: Record<string, MemorySourceType> = {
  benchmark_locomo: MemorySourceType.BenchmarkLocomo,
  chatTopic: MemorySourceType.ChatTopic,
  chatTopics: MemorySourceType.ChatTopic,
  chat_topic: MemorySourceType.ChatTopic,
};

const LAYER_ALIAS = new Set<LayersEnum>([
  LayersEnum.Activity,
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Identity,
  LayersEnum.Preference,
]);

const LAYER_LABEL_MAP: Record<LayersEnum, string> = {
  [LayersEnum.Activity]: 'activities',
  [LayersEnum.Context]: 'contexts',
  [LayersEnum.Experience]: 'experiences',
  [LayersEnum.Identity]: 'identities',
  [LayersEnum.Preference]: 'preferences',
};

export interface MemoryExtractionWorkflowCursor {
  createdAt: string;
  id: string;
}

export interface TopicWorkflowCursor extends MemoryExtractionWorkflowCursor {
  userId: string;
}

export interface MemoryExtractionNormalizedPayload {
  asyncTaskId?: string;
  baseUrl: string;
  forceAll: boolean;
  forceTopics: boolean;
  from?: Date;
  identityCursor: number;
  layers: LayersEnum[];
  /**
   * - `workflow` depends on Upstash Workflows to process the extraction asynchronously.
   * - `direct` processes the extraction within the webhook request itself.
   */
  mode: 'workflow' | 'direct';
  sourceIds?: string[];
  sources: MemorySourceType[];
  to?: Date;
  topicCursor?: TopicWorkflowCursor;
  topicIds: string[];
  userCursor?: MemoryExtractionWorkflowCursor;
  userId?: string;
  userIds: string[];
  userInitiated?: boolean;
}

export const memoryExtractionPayloadSchema = z.object({
  asyncTaskId: z.string().uuid().optional(),
  baseUrl: z.string().url().optional(),
  forceAll: z.boolean().optional(),
  forceTopics: z.boolean().optional(),
  fromDate: z.coerce.date().optional(),
  identityCursor: z.coerce.number().int().nonnegative().optional(),
  layers: z.array(z.nativeEnum(LayersEnum)).optional(),
  mode: z.enum(['workflow', 'direct']).optional(),
  sourceIds: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  toDate: z.coerce.date().optional(),
  topicCursor: z
    .object({
      createdAt: z.string(),
      id: z.string(),
      userId: z.string(),
    })
    .optional(),
  topicIds: z.array(z.string()).optional(),
  userCursor: z
    .object({
      createdAt: z.string(),
      id: z.string(),
    })
    .optional(),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  userInitiated: z.boolean().optional(),
});

export type MemoryExtractionPayloadInput = z.infer<typeof memoryExtractionPayloadSchema>;

const normalizeSources = (sources?: string[]): MemorySourceType[] => {
  if (!sources) return [];

  const normalized = sources
    .map((source) => SOURCE_ALIAS_MAP[source as keyof typeof SOURCE_ALIAS_MAP])
    .filter(Boolean) as MemorySourceType[];

  return Array.from(new Set(normalized));
};

const normalizeLayers = (layers?: string[]): LayersEnum[] => {
  if (!layers) return [];

  const normalized = layers
    .map((layer) => layer.toLowerCase() as LayersEnum)
    .filter((layer) => LAYER_ALIAS.has(layer));

  return Array.from(new Set(normalized));
};

export const normalizeMemoryExtractionPayload = (
  payload: MemoryExtractionPayloadInput,
  fallbackBaseUrl?: string,
): MemoryExtractionNormalizedPayload => {
  const parsed = memoryExtractionPayloadSchema.parse(payload);
  const baseUrl = parsed.baseUrl || fallbackBaseUrl;
  if (!baseUrl) throw new Error('Missing baseUrl for workflow trigger');

  return {
    asyncTaskId: parsed.asyncTaskId,
    baseUrl,
    forceAll: parsed.forceAll ?? false,
    forceTopics: parsed.forceTopics ?? false,
    from: parsed.fromDate,
    identityCursor: parsed.identityCursor ?? 0,
    layers: normalizeLayers(parsed.layers),
    mode: parsed.mode ?? 'workflow',
    sourceIds: Array.from(new Set(parsed.sourceIds || [])).filter(Boolean),
    sources: normalizeSources(parsed.sources),
    to: parsed.toDate,
    topicCursor: parsed.topicCursor,
    topicIds: Array.from(new Set(parsed.topicIds || [])).filter(Boolean),
    userCursor: parsed.userCursor,
    userId: parsed.userId ?? parsed.userIds?.[0],
    userIds: Array.from(
      new Set([...(parsed.userIds || []), ...(parsed.userId ? [parsed.userId] : [])]),
    ).filter(Boolean),
    userInitiated: parsed.userInitiated ?? false,
  };
};

export type UserTopicWorkflowPayload = MemoryExtractionPayloadInput;

export interface TopicBatchWorkflowPayload extends MemoryExtractionPayloadInput {
  topicIds: string[];
  userId: string;
}

export type ProviderKeyVaultMap = Record<
  string,
  AiProviderRuntimeState['runtimeConfig'][string]['keyVaults'] | undefined
>;

export const buildWorkflowPayloadInput = (
  payload: MemoryExtractionNormalizedPayload,
): MemoryExtractionPayloadInput => ({
  asyncTaskId: payload.asyncTaskId,
  baseUrl: payload.baseUrl,
  forceAll: payload.forceAll,
  forceTopics: payload.forceTopics,
  fromDate: payload.from,
  identityCursor: payload.identityCursor,
  layers: payload.layers,
  mode: payload.mode,
  sourceIds: payload.sourceIds,
  sources: payload.sources,
  toDate: payload.to,
  topicCursor: payload.topicCursor,
  topicIds: payload.topicIds,
  userCursor: payload.userCursor,
  userId: payload.userId ?? payload.userIds[0],
  userIds: payload.userIds,
  userInitiated: payload.userInitiated,
});

const normalizeProvider = (provider: string) => provider.toLowerCase();

const extractCredentialsFromVault = (vault?: Record<string, unknown>) => {
  if (!vault || typeof vault !== 'object') return {};

  const apiKey = 'apiKey' in vault && typeof vault.apiKey === 'string' ? vault.apiKey : undefined;
  const baseURL =
    'baseURL' in vault && typeof vault.baseURL === 'string' ? vault.baseURL : undefined;

  return { apiKey, baseURL };
};

const serializeError = (error: unknown): MemoryExtractionTraceError => {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }

  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
};

const resolveLayerModels = (
  layers: Partial<Record<GlobalMemoryLayer, string>> | undefined,
  fallback: Record<GlobalMemoryLayer, string>,
): Record<LayersEnum, string> => ({
  activity: layers?.activity ?? fallback.activity,
  context: layers?.context ?? fallback.context,
  experience: layers?.experience ?? fallback.experience,
  identity: layers?.identity ?? fallback.identity,
  preference: layers?.preference ?? fallback.preference,
});

const maskSecret = (value?: string) => {
  if (!value) return 'undefined';
  if (value.length <= 8) return `${value[0]}***${value.at(-1)}`;

  return `${value.slice(0, 6)}***${value.slice(-4)}`;
};

export type ProviderCredential = { apiKey?: string; baseURL?: string };

export type RuntimeResolveOptions = {
  fallback?: ProviderCredential;
  preferred?: {
    providerIds?: string[];
  };
};

export const resolveRuntimeAgentConfig = (
  agent: MemoryAgentConfig,
  keyVaults?: ProviderKeyVaultMap,
  options?: RuntimeResolveOptions,
) => {
  const normalizedPreferredProviders = (options?.preferred?.providerIds || [])
    .map(normalizeProvider)
    .filter(Boolean);

  const providerOrder = Array.from(
    new Set([
      ...normalizedPreferredProviders,
      normalizeProvider(agent.provider || 'openai'),
      ...Object.keys(keyVaults || {}),
    ]),
  );

  for (const provider of providerOrder) {
    if (provider === 'lobehub') {
      debugRuntimeInit(agent, {
        provider,
        source: 'user-vault' as const,
      });

      return ModelRuntime.initializeWithProvider(provider, {});
    }

    const { apiKey: userApiKey, baseURL: userBaseURL } = extractCredentialsFromVault(
      keyVaults?.[provider],
    );
    if (!userApiKey) {
      console.warn(
        `[memory-extraction] skipping provider ${provider} due to missing API key in user vault`,
      );
      continue;
    }

    debugRuntimeInit(agent, {
      apiKey: userApiKey,
      baseURL: userBaseURL,
      provider,
      source: 'user-vault' as const,
    });

    // Only use the user baseURL if we are also using their API key; otherwise fall back entirely
    // to system config to avoid mixing credentials.
    return ModelRuntime.initializeWithProvider(provider, {
      apiKey: userApiKey,
      baseURL: userBaseURL,
    });
  }

  debugRuntimeInit(agent, {
    apiKey: agent.apiKey || options?.fallback?.apiKey,
    baseURL: agent.baseURL || options?.fallback?.baseURL,
    provider: agent.provider || 'openai',
    source: 'system-config' as const,
  });

  return ModelRuntime.initializeWithProvider(agent.provider || 'openai', {
    apiKey: agent.apiKey || options?.fallback?.apiKey,
    baseURL: agent.baseURL || options?.fallback?.baseURL,
  });
};

const logRuntime = debug('lobe-server:memory:user-memory:runtime');

const debugRuntimeInit = (
  agent: MemoryAgentConfig,
  resolved: {
    apiKey?: string;
    baseURL?: string;
    provider: string;
    source: 'user-vault' | 'system-config';
  },
) => {
  if (!logRuntime.enabled) return;
  logRuntime('init runtime', {
    agentModel: agent.model,
    agentProvider: agent.provider || 'openai',
    apiKey: maskSecret(resolved.apiKey),
    baseURL: resolved.baseURL,
    provider: resolved.provider,
    source: resolved.source,
  });
};

const isTopicExtracted = (metadata?: ChatTopicMetadata | null): boolean => {
  const extractStatus = metadata?.userMemoryExtractStatus;
  if (extractStatus) return extractStatus === 'completed';

  return (
    metadata?.userMemoryExtractStatus === 'completed' &&
    !!metadata?.userMemoryExtractRunState?.lastRunAt
  );
};

type RuntimeBundle = {
  embeddings: ModelRuntime;
  gatekeeper: ModelRuntime;
  layerExtractor: ModelRuntime;
};

export interface TopicExtractionJob {
  asyncTaskId?: string;
  forceAll: boolean;
  forceTopics: boolean;
  from?: Date;
  layers: LayersEnum[];
  source: MemorySourceType;
  to?: Date;
  topicId: string;
  userId: string;
  userInitiated?: boolean;
}

export interface TopicPaginationJob {
  cursor?: ListTopicsForMemoryExtractorCursor;
  forceAll: boolean;
  forceTopics: boolean;
  from?: Date;
  to?: Date;
  userId: string;
}

export interface UserPaginationResult {
  cursor?: ListUsersForMemoryExtractorCursor;
  ids: string[];
}

type MemoryExtractionConfig = ReturnType<typeof parseMemoryExtractionConfig>;
type ServerConfig = Awaited<ReturnType<typeof getServerGlobalConfig>>;

export class MemoryExtractionExecutor {
  private readonly aiProviderConfig: Record<string, ProviderConfig>;
  private readonly embeddingPreferredModels?: string[];
  private readonly embeddingPreferredProviders?: string[];
  private readonly gatekeeperPreferredModels?: string[];
  private readonly gatekeeperPreferredProviders?: string[];
  private readonly layerPreferredModels?: string[];
  private readonly layerPreferredProviders?: string[];
  private readonly privateConfig: MemoryExtractionConfig;
  private readonly modelConfig: {
    embeddingsModel: string;
    gateModel: string;
    layerModels: Partial<Record<LayersEnum, string>>;
    observabilityS3: MemoryExtractionConfig['observabilityS3'];
  };
  private readonly embeddingContextLimit?: number;

  private readonly runtimeCache = new Map<string, RuntimeBundle>();
  private readonly db = getServerDB();

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

    this.embeddingContextLimit =
      privateConfig.embedding?.contextLimit ?? privateConfig.agentLayerExtractor.contextLimit;
  }

  static async create() {
    const [serverConfig, privateConfig] = await Promise.all([
      getServerGlobalConfig(),
      Promise.resolve(parseMemoryExtractionConfig()),
    ]);

    return new MemoryExtractionExecutor(serverConfig, privateConfig);
  }

  private buildBaseMetadata(
    job: MemoryExtractionJob,
    messageIds: string[],
    layer: LayersEnum,
    labels?: string[] | null,
  ) {
    return {
      labels: labels ?? undefined,
      layer,
      messageIds,
      source: job.source,
      sourceId: job.sourceId,
    };
  }

  private async countTokens(text: string) {
    const normalized = text.trim();
    if (!normalized) return 0;

    return await encodeAsync(normalized);
  }

  private async trimTextToTokenLimit(text: string, tokenLimit?: number) {
    return trimBasedOnBatchProbe(text, tokenLimit);
  }

  private async trimConversationsToTokenLimit<T extends OpenAIChatMessage>(
    conversations: (T & { createdAt: Date })[],
    tokenLimit?: number,
  ) {
    if (!tokenLimit || tokenLimit <= 0) return conversations;

    let remaining = tokenLimit;
    const trimmed: (T & { createdAt: Date })[] = [];

    for (let i = conversations.length - 1; i >= 0 && remaining > 0; i -= 1) {
      const conversation = conversations[i];
      // TODO: we might need to think about how to deal with non-string contents
      // as multi-modal models become more prevalent
      const content =
        typeof conversation.content === 'string'
          ? conversation.content
          : JSON.stringify(conversation.content);

      const tokenCount = await this.countTokens(content);
      if (tokenCount <= remaining) {
        trimmed.push(conversation);
        remaining -= tokenCount;
        continue;
      }

      const trimmedContent =
        typeof conversation.content === 'string'
          ? await this.trimTextToTokenLimit(conversation.content, remaining)
          : conversation.content;

      if (trimmedContent && remaining > 0) {
        trimmed.push({ ...conversation, content: trimmedContent });
      }

      break;
    }

    return trimmed.reverse();
  }

  private async generateEmbeddings(
    runtimes: ModelRuntime,
    model: string,
    texts: Array<string | undefined | null>,
    tokenLimit?: number,
  ) {
    const attributes = {
      [ATTR_GEN_AI_OPERATION_NAME]: 'embed',
      [ATTR_GEN_AI_REQUEST_MODEL]: model,
      memory_embedding_token_limit: tokenLimit ?? undefined,
      ...attributesCommon(),
    };

    return tracer.startActiveSpan('gen_ai.embed', { attributes }, async (span) => {
      const requests: { index: number; text: string }[] = [];
      for (const [index, text] of texts.entries()) {
        if (typeof text !== 'string') continue;

        const trimmed = await this.trimTextToTokenLimit(text, tokenLimit);
        if (!trimmed.trim()) continue;

        requests.push({ index, text: trimmed });
      }

      span.setAttribute('memory.embedding.text_count', texts.length);
      span.setAttribute('memory.embedding.request_count', requests.length);

      if (requests.length === 0) {
        span.setStatus({ code: SpanStatusCode.OK, message: 'empty_requests' });
        span.end();
        return texts.map(() => null);
      }

      try {
        const response = await runtimes.embeddings(
          {
            dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
            input: requests.map((item) => item.text),
            model,
          },
          { user: 'memory-extraction' },
        );

        const vectors = texts.map<Embeddings | null>(() => null);
        response?.forEach((embedding, idx) => {
          const request = requests[idx];
          if (request) {
            vectors[request.index] = embedding;
          }
        });

        span.setAttribute('memory.embedding.response_count', response?.length ?? 0);
        span.setStatus({ code: SpanStatusCode.OK });

        return vectors;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Failed to generate embeddings',
        });
        span.recordException(error as Error);
        console.error('[memory-extraction] failed to generate embeddings', error, 'model:', model);

        return texts.map(() => null);
      } finally {
        span.end();
      }
    });
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
    const insertedIds: string[] = [];
    const userMemoryModel = new UserMemoryModel(db, job.userId);

    for (const item of result?.memories ?? []) {
      const activityTags = item.withActivity?.tags ?? item.tags;
      const associatedObjects = UserMemoryModel.parseAssociatedObjects(
        item.withActivity?.associatedObjects,
      );
      const associatedSubjects = UserMemoryModel.parseAssociatedSubjects(
        item.withActivity?.associatedSubjects,
      );
      const associatedLocations = UserMemoryModel.parseAssociatedLocations(
        item.withActivity?.associatedLocations,
      );
      const [summaryVector, detailsVector, narrativeVector, feedbackVector] =
        await this.generateEmbeddings(
          runtime,
          model,
          [item.summary, item.details, item.withActivity?.narrative, item.withActivity?.feedback],
          tokenLimit,
        );
      const baseMetadata = this.buildBaseMetadata(
        job,
        messageIds,
        LayersEnum.Activity,
        activityTags,
      );

      const { memory } = await userMemoryModel.createActivityMemory({
        activity: {
          associatedLocations: associatedLocations.length > 0 ? associatedLocations : [],
          associatedObjects: associatedObjects.length > 0 ? associatedObjects : [],
          associatedSubjects: associatedSubjects.length > 0 ? associatedSubjects : [],
          capturedAt: job.sourceUpdatedAt,
          endsAt: UserMemoryModel.parseDateFromString(item.withActivity?.endsAt),
          feedback: item.withActivity?.feedback ?? null,
          feedbackVector: feedbackVector ?? null,
          metadata: baseMetadata,
          narrative: item.withActivity?.narrative ?? null,
          narrativeVector: narrativeVector ?? null,
          notes: item.withActivity?.notes ?? null,
          startsAt: UserMemoryModel.parseDateFromString(item.withActivity?.startsAt),
          status: item.withActivity?.status ?? 'pending',
          tags: activityTags ?? null,
          timezone: item.withActivity?.timezone ?? null,
          type: item.withActivity?.type ?? 'other',
        },
        capturedAt: job.sourceUpdatedAt,
        details: item.details ?? '',
        detailsEmbedding: detailsVector ?? undefined,
        memoryCategory: item.memoryCategory ?? null,
        memoryLayer: LayersEnum.Activity,
        memoryType: (item.memoryType as TypesEnum) ?? TypesEnum.Activity,
        summary: item.summary ?? '',
        summaryEmbedding: summaryVector ?? undefined,
        title: item.title ?? '',
      });

      insertedIds.push(memory.id);
    }

    return insertedIds;
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
    const insertedIds: string[] = [];
    const userMemoryModel = new UserMemoryModel(db, job.userId);

    for (const item of result?.memories ?? []) {
      const [summaryVector, detailsVector, descriptionVector] = await this.generateEmbeddings(
        runtime,
        model,
        [item.summary, item.details, item.withContext?.description],
        tokenLimit,
      );
      const baseMetadata = this.buildBaseMetadata(
        job,
        messageIds,
        LayersEnum.Context,
        item.withContext?.labels,
      );

      const { memory } = await userMemoryModel.createContextMemory({
        capturedAt: job.sourceUpdatedAt,
        context: {
          associatedObjects: UserMemoryModel.parseAssociatedObjects(
            item.withContext?.associatedObjects,
          ),
          associatedSubjects: UserMemoryModel.parseAssociatedSubjects(
            item.withContext?.associatedSubjects,
          ),
          capturedAt: job.sourceUpdatedAt,
          currentStatus: item.withContext?.currentStatus ?? null,
          description: item.withContext?.description ?? null,
          descriptionVector: descriptionVector || null,
          metadata: baseMetadata,
          scoreImpact: item.withContext?.scoreImpact ?? null,
          scoreUrgency: item.withContext?.scoreUrgency ?? null,
          tags: item.withContext?.labels ?? null,
          title: item.withContext?.title ?? null,
          type: item.withContext?.type ?? null,
        },
        details: item.details ?? '',
        detailsEmbedding: detailsVector ?? undefined,
        memoryCategory: item.memoryCategory ?? null,
        memoryLayer: LayersEnum.Context,
        memoryType: (item.memoryType as TypesEnum) ?? TypesEnum.Context,
        summary: item.summary ?? '',
        summaryEmbedding: summaryVector ?? undefined,
        title: item.title ?? '',
      });

      insertedIds.push(memory.id);
    }

    return insertedIds;
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
    const insertedIds: string[] = [];
    const userMemoryModel = new UserMemoryModel(db, job.userId);

    for (const item of result?.memories ?? []) {
      const [summaryVector, detailsVector, situationVector, actionVector, keyLearningVector] =
        await this.generateEmbeddings(
          runtime,
          model,
          [
            item.summary,
            item.details,
            item.withExperience?.situation,
            item.withExperience?.action,
            item.withExperience?.keyLearning,
          ],
          tokenLimit,
        );
      const baseMetadata = this.buildBaseMetadata(
        job,
        messageIds,
        LayersEnum.Experience,
        item.withExperience?.labels,
      );

      const { memory } = await userMemoryModel.createExperienceMemory({
        capturedAt: job.sourceUpdatedAt,
        details: item.details ?? '',
        detailsEmbedding: detailsVector ?? undefined,
        experience: {
          action: item.withExperience?.action ?? null,
          actionVector: actionVector || null,
          capturedAt: job.sourceUpdatedAt,
          keyLearning: item.withExperience?.keyLearning ?? null,
          keyLearningVector: keyLearningVector || null,
          metadata: baseMetadata,
          possibleOutcome: item.withExperience?.possibleOutcome ?? null,
          reasoning: item.withExperience?.reasoning ?? null,
          scoreConfidence: item.withExperience?.scoreConfidence ?? null,
          situation: item.withExperience?.situation ?? null,
          situationVector: situationVector || null,
          tags: item.withExperience?.labels ?? null,
          type: item.withExperience?.type ?? null,
        },
        memoryCategory: item.memoryCategory ?? null,
        memoryLayer: LayersEnum.Experience,
        memoryType: (item.memoryType as TypesEnum) ?? TypesEnum.Activity,
        summary: item.summary ?? '',
        summaryEmbedding: summaryVector ?? undefined,
        title: item.title ?? '',
      });

      insertedIds.push(memory.id);
    }

    return insertedIds;
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
    const insertedIds: string[] = [];
    const userMemoryModel = new UserMemoryModel(db, job.userId);

    for (const item of result?.memories ?? []) {
      const [summaryVector, detailsVector, directiveVector] = await this.generateEmbeddings(
        runtime,
        model,
        [item.summary, item.details, item.withPreference?.conclusionDirectives],
        tokenLimit,
      );
      const baseMetadata = this.buildBaseMetadata(
        job,
        messageIds,
        LayersEnum.Preference,
        item.withPreference?.extractedLabels,
      );

      const { memory } = await userMemoryModel.createPreferenceMemory({
        capturedAt: job.sourceUpdatedAt,
        details: item.details ?? '',
        detailsEmbedding: detailsVector ?? undefined,
        memoryCategory: item.memoryCategory ?? null,
        memoryLayer: LayersEnum.Preference,
        memoryType: (item.memoryType as TypesEnum) ?? TypesEnum.Preference,
        preference: {
          capturedAt: job.sourceUpdatedAt,
          conclusionDirectives: item.withPreference?.conclusionDirectives ?? null,
          conclusionDirectivesVector: directiveVector ?? null,
          metadata: {
            ...baseMetadata,
            scopes: item.withPreference?.extractedScopes ?? undefined,
          },
          scorePriority: item.withPreference?.scorePriority ?? null,
          suggestions: item.withPreference?.suggestions?.join('\n') ?? null,
          tags: item.withPreference?.extractedLabels ?? null,
          type: item.withPreference?.type ?? null,
        },
        summary: item.summary ?? '',
        summaryEmbedding: summaryVector ?? undefined,
        title: item.title ?? '',
      });

      insertedIds.push(memory.id);
    }

    return insertedIds;
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
    const insertedIds: string[] = [];
    const userMemoryModel = new UserMemoryModel(db, job.userId);

    const addActions = result?.add ?? [];
    const updateActions = result?.update ?? [];
    const removeActions = result?.remove ?? [];

    for (const action of addActions) {
      const [summaryVector, detailsVector, descriptionVector] = await this.generateEmbeddings(
        runtime,
        model,
        [action.summary, action.details, action.withIdentity.description],
        tokenLimit,
      );
      const metadata = this.buildBaseMetadata(
        job,
        messageIds,
        LayersEnum.Identity,
        action.withIdentity?.extractedLabels,
      );

      const res = await userMemoryModel.addIdentityEntry({
        base: {
          capturedAt: job.sourceUpdatedAt,
          details: action.details,
          detailsVector1024: detailsVector ?? undefined,
          memoryCategory: 'people',
          memoryLayer: LayersEnum.Identity,
          memoryType: TypesEnum.People,
          metadata,
          summary: action.summary,
          summaryVector1024: summaryVector ?? undefined,
          title: action.title,
        },
        identity: {
          capturedAt: job.sourceUpdatedAt,
          description: action.withIdentity.description,
          descriptionVector: descriptionVector ?? undefined,
          metadata,
          relationship: action.withIdentity.relationship ?? undefined,
          role: action.withIdentity.role ?? undefined,
          tags: action.withIdentity.extractedLabels ?? undefined,
          type: action.withIdentity.type ?? undefined,
        },
      });

      insertedIds.push(res.userMemoryId);
    }

    for (const action of updateActions) {
      const { set } = action;

      const [summaryVector, detailsVector, descriptionVector] = set.withIdentity?.description
        ? await this.generateEmbeddings(
            runtime,
            model,
            [set.summary, set.details, set.withIdentity.description],
            tokenLimit,
          )
        : [];

      await userMemoryModel.updateIdentityEntry({
        base: {
          capturedAt: job.sourceUpdatedAt,
          details: set.details,
          detailsVector1024: detailsVector ?? undefined,
          memoryCategory: set.memoryCategory,
          memoryType: set.memoryType,
          summary: set.summary,
          summaryVector1024: summaryVector ?? undefined,
          tags: set.tags,
          title: set.title,
        },
        identity: {
          capturedAt: job.sourceUpdatedAt,
          description: set.withIdentity?.description,
          descriptionVector: descriptionVector ?? undefined,
          metadata: set.withIdentity.extractedLabels
            ? this.buildBaseMetadata(
                job,
                messageIds,
                LayersEnum.Identity,
                set.withIdentity.extractedLabels,
              )
            : undefined,
          relationship: set.withIdentity.relationship ?? undefined,
          role: set.withIdentity.role ?? undefined,
          type: set.withIdentity.type ?? undefined,
        },
        identityId: action.id,
        mergeStrategy: action.mergeStrategy as MergeStrategyEnum,
      });
    }

    for (const action of removeActions) {
      await userMemoryModel.removeIdentityEntry(action.id);
    }

    return insertedIds;
  }

  async listConversationsForTopic(userId: string, topicId: string, topicUpdatedAt: Date) {
    const db = await this.db;
    const rows = await db
      .select({
        content: messages.content,
        createdAt: messages.createdAt,
        id: messages.id,
        role: messages.role,
      })
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.topicId, topicId)))
      .orderBy(asc(messages.createdAt));

    const conversation = rows
      .filter((row) => typeof row.content === 'string' && row.content.trim().length > 0)
      .map(
        (row) =>
          ({
            content: row.content as string,
            createdAt: row.createdAt ?? topicUpdatedAt,
            id: row.id,
            role: (row.role ?? 'assistant') as LLMRoleType,
          }) satisfies OpenAIChatMessage & { createdAt: Date; id: string },
      );

    if (conversation.length === 0) {
      return [];
    }

    return conversation;
  }

  async listRelevantUserMemories(
    job: MemoryExtractionJob,
    runtime: ModelRuntime,
    embeddingModel: string,
    userId: string,
    conversations: OpenAIChatMessage[],
    tokenLimit?: number,
  ) {
    const db = await this.db;
    const userMemoryModel = new UserMemoryModel(db, userId);
    // TODO: make topK configurable
    const topK = 10;
    const aggregatedContent = await this.trimTextToTokenLimit(
      conversations.map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`).join('\n\n'),
      tokenLimit,
    );

    const embeddings = await runtime.embeddings({
      dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
      input: [aggregatedContent],
      model: embeddingModel,
    });

    const vector = embeddings?.[0];
    if (vector) {
      const retrieved = await userMemoryModel.searchWithEmbedding({
        embedding: vector,
        limits: { activities: topK, contexts: topK, experiences: topK, preferences: topK },
      });

      return retrieved;
    }

    return {
      activities: [],
      contexts: [],
      experiences: [],
      preferences: [],
    };
  }

  async listUserMemoryIdentities(
    job: MemoryExtractionJob,
    userId: string,
  ): Promise<IdentityMemoryDetail[]> {
    const db = await this.db;
    const userMemoryModel = new UserMemoryModel(db, userId);

    const res = await userMemoryModel.getAllIdentitiesWithMemory();

    return res.map((item) => ({ ...item, layer: LayersEnum.Identity }));
  }

  private async reportUserInitiatedProgress(job: TopicExtractionJob) {
    if (!job.asyncTaskId || !job.userInitiated) return;

    try {
      const db = await this.db;
      const asyncTaskModel = new AsyncTaskModel(db, job.userId);
      await asyncTaskModel.incrementUserMemoryExtractionProgress(job.asyncTaskId);
    } catch (error) {
      console.error('[memory-extraction] failed to update async task progress', error);
    }
  }

  async extractTopic(job: TopicExtractionJob) {
    const attributes = {
      source: job.source,
      source_id: job.topicId,
      user_id: job.userId,
    };

    let observabilityS3: S3 | undefined;
    if (this.modelConfig.observabilityS3?.enabled) {
      observabilityS3 = new S3(
        this.modelConfig.observabilityS3?.accessKeyId,
        this.modelConfig.observabilityS3?.secretAccessKey,
        this.modelConfig.observabilityS3?.endpoint,
        {
          bucket: this.modelConfig.observabilityS3?.bucketName,
          forcePathStyle: this.modelConfig.observabilityS3?.forcePathStyle,
          region: this.modelConfig.observabilityS3?.region,
          setAcl: false,
        },
      );
    }

    return tracer.startActiveSpan(
      'Memory User Memory: Extract Chat Topic',
      { attributes },
      async (span) => {
        const shouldReportProgress = job.userInitiated && !!job.asyncTaskId;
        let topicProcessed = false;
        const startTime = Date.now();
        let extractionJob: MemoryExtractionJob | null = null;
        let extraction: MemoryExtractionResult | null = null;
        let resultRecorder: LobeChatTopicResultRecorder | null = null;
        let tracePayload: MemoryExtractionTracePayload<
          MemoryExtractionResult,
          MemoryExtractionJob | null,
          GenerateObjectPayload
        > | null = null;

        try {
          const db = await this.db;
          const topic = await db.query.topics.findFirst({
            columns: { createdAt: true, id: true, metadata: true, updatedAt: true, userId: true },
            where: and(eq(topics.id, job.topicId), eq(topics.userId, job.userId)),
          });

          if (!topic) {
            console.warn(
              `[memory-extraction] topic ${job.topicId} not found for user ${job.userId}`,
            );
            span.setStatus({ code: SpanStatusCode.OK, message: 'topic_not_found' });
            topicProcessed = true;
            return {
              extracted: false,
              layers: {},
              memoryIds: [],
              traceId: span.spanContext().traceId,
            };
          }
          if ((job.from && topic.createdAt < job.from) || (job.to && topic.createdAt > job.to)) {
            span.setStatus({ code: SpanStatusCode.OK, message: 'topic_out_of_range' });
            topicProcessed = true;
            return {
              extracted: false,
              layers: {},
              memoryIds: [],
              traceId: span.spanContext().traceId,
            };
          }
          if (!job.forceAll && !job.forceTopics && isTopicExtracted(topic.metadata)) {
            span.setStatus({ code: SpanStatusCode.OK, message: 'already_extracted' });
            topicProcessed = true;
            return {
              extracted: false,
              layers: {},
              memoryIds: [],
              traceId: span.spanContext().traceId,
            };
          }

          extractionJob = {
            force: job.forceAll || job.forceTopics,
            layers: job.layers,
            source: job.source,
            sourceId: topic.id,
            sourceUpdatedAt: topic.updatedAt,
            userId: job.userId,
          };

          const userModel = new UserModel(db, job.userId);
          const [userState, aiProviderRuntimeState] = await Promise.all([
            userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults),
            this.getAiProviderRuntimeState(job.userId),
          ]);
          const keyVaults = await this.resolveRuntimeKeyVaults(aiProviderRuntimeState);
          const language = userState.settings?.general?.responseLanguage;

          const runtimes = await this.getRuntime(job.userId, keyVaults);

          const conversations = await this.listConversationsForTopic(
            job.userId,
            topic.id,
            topic.updatedAt,
          );
          if (!conversations || conversations.length === 0) {
            if (extractionJob) {
              this.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
            }
            span.setStatus({ code: SpanStatusCode.OK, message: 'empty_conversations' });
            return {
              extracted: false,
              layers: {},
              memoryIds: [],
              traceId: span.spanContext().traceId,
            };
          }

          const extractorContextLimit = this.privateConfig.agentLayerExtractor.contextLimit;
          const embeddingContextLimit = this.embeddingContextLimit ?? extractorContextLimit;
          const extractorConversations = await this.trimConversationsToTokenLimit(
            conversations,
            extractorContextLimit,
          );
          const embeddingConversations = await this.trimConversationsToTokenLimit(
            conversations,
            embeddingContextLimit,
          );

          const messageIds = extractorConversations.map((item) => item.id);

          const topicContextProvider = new LobeChatTopicContextProvider({
            conversations: extractorConversations,
            topic: topic,
            topicId: topic.id,
          });
          const topicContext = await topicContextProvider.buildContext(extractionJob.userId);

          resultRecorder = new LobeChatTopicResultRecorder({
            currentMetadata: topic.metadata || {},
            database: db,
            lastMessageAt: (conversations?.at(-1)?.createdAt || topic.updatedAt).toISOString(),
            messageCount: conversations.length,
            topicId: topic.id,
            traceId: span.spanContext().traceId,
          });

          const retrievedMemories = await this.listRelevantUserMemories(
            extractionJob,
            runtimes.embeddings,
            this.modelConfig.embeddingsModel,
            job.userId,
            embeddingConversations,
            embeddingContextLimit,
          );
          const retrievedMemoryContextProvider = new RetrievalUserMemoryContextProvider({
            retrievedMemories,
          });
          const retrievalMemoryContext = await retrievedMemoryContextProvider.buildContext(
            extractionJob.userId,
            extractionJob.sourceId,
          );

          const retrievedMemoryIdentities = await this.listUserMemoryIdentities(
            extractionJob,
            job.userId,
          );
          const retrievedMemoryIdentitiesContextProvider =
            new RetrievalUserMemoryIdentitiesProvider({
              retrievedIdentities: retrievedMemoryIdentities,
            });
          const retrievedIdentityContext =
            await retrievedMemoryIdentitiesContextProvider.buildContext(
              extractionJob.userId,
              extractionJob.sourceId,
            );
          const trimmedRetrievedContexts = await Promise.all(
            [topicContext.context, retrievalMemoryContext.context].map((context) =>
              this.trimTextToTokenLimit(context, extractorContextLimit),
            ),
          );
          const trimmedRetrievedIdentitiesContext = await this.trimTextToTokenLimit(
            retrievedIdentityContext.context,
            extractorContextLimit,
          );

          const agentCalls: Partial<
            Record<MemoryExtractionAgent, MemoryExtractionAgentCallTrace<GenerateObjectPayload>>
          > = {};
          const agentStartedAt: Partial<Record<MemoryExtractionAgent, number>> = {};

          const recordRequest = (agent: MemoryExtractionAgent, request: GenerateObjectPayload) => {
            agentStartedAt[agent] = Date.now();
            agentCalls[agent] = { ...agentCalls[agent], request };
          };

          const recordResponse = (agent: MemoryExtractionAgent, response: unknown) => {
            const duration = agentStartedAt[agent]
              ? Date.now() - agentStartedAt[agent]!
              : undefined;
            agentCalls[agent] = { ...agentCalls[agent], durationMs: duration, response };
          };

          const recordError = (agent: MemoryExtractionAgent, error: unknown) => {
            const duration = agentStartedAt[agent]
              ? Date.now() - agentStartedAt[agent]!
              : undefined;
            agentCalls[agent] = {
              ...agentCalls[agent],
              durationMs: duration,
              error: serializeError(error),
            };
          };

          tracePayload = {
            agentCalls,
            contexts: {
              built: {
                retrievalMemoryContext,
                retrievedIdentityContext,
                topicContext,
              },
              trimmed: {
                retrievedContexts: trimmedRetrievedContexts,
                retrievedIdentitiesContext: trimmedRetrievedIdentitiesContext,
              },
            },
            extractionJob,
            memories: {
              identities: retrievedMemoryIdentities,
              layers: retrievedMemories,
            },
            source: {
              chatTopic: {
                conversations: extractorConversations,
                topic,
              },
            },
            sourceType: extractionJob.source,
            userId: job.userId,
          };

          const service = new MemoryExtractionService({
            config: this.modelConfig,
            db,
            language,
            runtimes,
          });

          const shouldRecordTrace = Boolean(observabilityS3);

          extraction = await service.run(extractionJob, {
            callbacks: shouldRecordTrace
              ? {
                  onExtractError: async (agent, error) => {
                    recordError(agent, error);
                  },
                  onExtractRequest: async (agent, payload) => {
                    recordRequest(agent, payload);
                  },
                  onExtractResponse: async (agent, response) => {
                    recordResponse(agent, response);
                  },
                }
              : undefined,
            contextProvider: topicContextProvider,
            gatekeeperLanguage: this.privateConfig.agentGateKeeper.language || 'English',
            language: language,
            resultRecorder: resultRecorder as any,
            retrievedContexts: trimmedRetrievedContexts,
            retrievedIdentitiesContext: trimmedRetrievedIdentitiesContext,

            sessionDate: topic.updatedAt.toISOString(),
            // TODO: make topK configurable
            topK: 10,
            username:
              userState.fullName || `${userState.firstName} ${userState.lastName}`.trim() || 'User',
          });
          if (!extraction) {
            this.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
            span.setStatus({ code: SpanStatusCode.OK, message: 'no_extraction' });
            topicProcessed = true;
            return {
              extracted: false,
              layers: {},
              memoryIds: [],
              traceId: span.spanContext().traceId,
            };
          }

          const persistedRes = await this.persistExtraction(
            extractionJob,
            messageIds,
            extraction,
            runtimes,
            db,
          );
          if (tracePayload) {
            tracePayload.result = { extraction, persisted: persistedRes };
          }
          await resultRecorder.recordComplete(extractionJob, {
            ...persistedRes,
            processedMemoryCount: persistedRes.createdIds.length,
          });
          this.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute('memory.processed_memory_count', persistedRes.createdIds.length);

          topicProcessed = true;
          return {
            extracted: true,
            layers: persistedRes.layers,
            memoryIds: persistedRes.createdIds,
            traceId: span.spanContext().traceId,
          };
        } catch (error) {
          if (extraction && extractionJob && resultRecorder) {
            await resultRecorder.recordFail?.(extractionJob, error as Error);
          }
          if (extractionJob) {
            this.recordJobMetrics(extractionJob, 'failed', Date.now() - startTime);
          }
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Extraction failed',
          });
          span.recordException(error as Error);
          console.error(
            '[memory-extraction] topic extraction failed',
            error,
            'topicId:',
            job.topicId,
            'userId:',
            job.userId,
          );

          if (tracePayload) {
            tracePayload.error = serializeError(error);
          }
          if (job.asyncTaskId && job.userInitiated) {
            try {
              const asyncTaskModel = new AsyncTaskModel(await this.db, job.userId);
              await asyncTaskModel.update(job.asyncTaskId, {
                error: new AsyncTaskError(
                  AsyncTaskErrorType.ServerError,
                  error instanceof Error ? error.message : 'Extraction failed',
                ),
                status: AsyncTaskStatus.Error,
              });
            } catch (taskError) {
              console.error('[memory-extraction] failed to update async task status', taskError);
            }
          }
          throw error;
        } finally {
          if (shouldReportProgress && topicProcessed) {
            await this.reportUserInitiatedProgress(job);
          }

          if (observabilityS3 && tracePayload) {
            try {
              await this.uploadExtractionTrace(
                tracePayload,
                job.userId,
                extractionJob?.source ?? job.source,
                extractionJob?.sourceId ?? job.topicId,
                observabilityS3,
              );
            } catch (err) {
              console.error('[memory-extraction] failed to upload extraction trace', err);
            }
          }
          span.end();
        }
      },
    );
  }

  private getOnExtractHooksPath(
    userId: string,
    source: string,
    sourceId: string,
  ): string | undefined {
    if (!this.modelConfig.observabilityS3?.enabled) {
      return undefined;
    }

    const withoutBase = `memory-extraction/${userId}/${source}/${sourceId}/`;
    const base = this.modelConfig.observabilityS3?.pathPrefix
      ? this.modelConfig.observabilityS3?.pathPrefix.startsWith('/')
        ? this.modelConfig.observabilityS3?.pathPrefix.slice(1)
        : this.modelConfig.observabilityS3?.pathPrefix
      : '';

    const key = join(`${base}`, withoutBase);
    return key;
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
    if (!this.modelConfig.observabilityS3?.enabled) return;

    const key = join(
      this.getOnExtractHooksPath(userId, source, sourceId)!,
      'trace',
      `${new Date().toISOString()}.json`,
    );

    await s3.uploadContent(key, JSON.stringify(payload, null, 2));
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
        const topicIds = await this.filterTopicIdsForUser(userId, payload.topicIds);
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
    const db = await this.db;
    const topicModel = new TopicModel(db, job.userId);
    const rows = await topicModel.listTopicsForMemoryExtractor({
      cursor: job.cursor,
      endDate: job.to,
      ignoreExtracted: job.forceAll || job.forceTopics,
      limit: pageSize,
      startDate: job.from,
    });
    if (!rows?.length) {
      return { ids: [] };
    }

    const last = rows.at(-1);
    const nextCursor = last
      ? {
          createdAt: last.createdAt,
          id: last.id,
        }
      : undefined;

    return {
      cursor: nextCursor,
      ids: rows.map((topic) => topic.id),
    };
  }

  async getUsers(
    limit: number,
    cursor?: ListUsersForMemoryExtractorCursor,
  ): Promise<UserPaginationResult> {
    const db = await this.db;

    const rows = await UserModel.listUsersForMemoryExtractor(db, {
      cursor,
      limit,
      whitelist: this.privateConfig.whitelistUsers,
    });
    if (!rows?.length) {
      return { ids: [] };
    }

    const last = rows.at(-1);
    const nextCursor = last
      ? {
          createdAt: last.createdAt,
          id: last.id,
        }
      : undefined;

    return {
      cursor: nextCursor,
      ids: rows.map((row) => row.id),
    };
  }

  async filterTopicIdsForUser(userId: string, topicIds: string[]) {
    if (!topicIds.length) return [];

    const db = await this.db;
    const rows = await db.query.topics.findMany({
      columns: { id: true },
      where: and(eq(topics.userId, userId), inArray(topics.id, topicIds)),
    });

    return rows.map((row) => row.id);
  }

  private recordJobMetrics(
    job: MemoryExtractionJob,
    status: 'completed' | 'failed',
    durationMs: number,
  ) {
    processedSourceCounter.add(1, {
      source: job.source,
      status,
      user_id: job.userId,
      ...attributesCommon(),
    });
    processedDurationHistogram.record(durationMs, {
      source: job.source,
      user_id: job.userId,
      ...attributesCommon(),
    });
  }

  private recordLayerEntries(job: MemoryExtractionJob, layer: LayersEnum, count: number) {
    layerEntriesHistogram.record(count, {
      layer: LAYER_LABEL_MAP[layer],
      source: job.source,
      user_id: job.userId,
      ...attributesCommon(),
    });
  }

  private normalizeLayerError(layer: LayersEnum, stage: 'extract' | 'persist', error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`[${stage}] ${LAYER_LABEL_MAP[layer]}: ${message}`);
  }

  private async persistExtraction(
    job: MemoryExtractionJob,
    messageIds: string[],
    extraction: MemoryExtractionResult,
    runtimes: RuntimeBundle,
    db: Awaited<ReturnType<typeof getServerDB>>,
  ): Promise<PersistedMemoryResult> {
    const createdIds: string[] = [];
    const perLayer: Partial<Record<LayersEnum, number>> = {};
    const errors: Error[] = [];
    const appendError = (layer: LayersEnum, stage: 'extract' | 'persist', error: unknown) => {
      errors.push(this.normalizeLayerError(layer, stage, error));
    };

    const persistWithSpan = async (
      layer: LayersEnum,
      persist: () => Promise<string[]>,
    ): Promise<void> => {
      const attributes = {
        layer: LAYER_LABEL_MAP[layer],
        source: job.source,
        source_id: job.sourceId,
        user_id: job.userId,
        ...attributesCommon(),
      };

      await tracer.startActiveSpan(
        `Memory User Memory: Persist ${LAYER_LABEL_MAP[layer]}`,
        { attributes },
        async (span) => {
          try {
            const ids = await persist();

            createdIds.push(...ids);
            perLayer[layer] = ids.length;
            this.recordLayerEntries(job, layer, ids.length);
            span.setStatus({ code: SpanStatusCode.OK });
            span.setAttribute('memory.persisted_count', ids.length);
          } catch (error) {
            appendError(layer, 'persist', error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                error instanceof Error ? error.message : 'Failed to persist extracted memories',
            });
            span.recordException(error as Error);
            console.error(
              '[memory-extraction] failed to persist memories',
              error,
              'layer:',
              layer,
              'source:',
              job.source,
              'sourceId:',
              job.sourceId,
              'userId:',
              job.userId,
            );
          } finally {
            span.end();
          }
        },
      );
    };

    const activityOutput = extraction.outputs.activity;
    if (activityOutput?.error) {
      appendError(LayersEnum.Activity, 'extract', activityOutput.error);
    }
    if (activityOutput?.data) {
      await persistWithSpan(LayersEnum.Activity, () =>
        this.persistActivityMemories(
          job,
          messageIds,
          activityOutput.data,
          runtimes.embeddings,
          this.modelConfig.embeddingsModel,
          this.embeddingContextLimit,
          db,
        ),
      );
    }

    const contextOutput = extraction.outputs.context;
    if (contextOutput?.error) {
      appendError(LayersEnum.Context, 'extract', contextOutput.error);
    }
    if (contextOutput?.data) {
      await persistWithSpan(LayersEnum.Context, () =>
        this.persistContextMemories(
          job,
          messageIds,
          contextOutput.data,
          runtimes.embeddings,
          this.modelConfig.embeddingsModel,
          this.embeddingContextLimit,
          db,
        ),
      );
    }

    const experienceOutput = extraction.outputs.experience;
    if (experienceOutput?.error) {
      appendError(LayersEnum.Experience, 'extract', experienceOutput.error);
    }
    if (experienceOutput?.data) {
      await persistWithSpan(LayersEnum.Experience, () =>
        this.persistExperienceMemories(
          job,
          messageIds,
          experienceOutput.data,
          runtimes.embeddings,
          this.modelConfig.embeddingsModel,
          this.embeddingContextLimit,
          db,
        ),
      );
    }

    const preferenceOutput = extraction.outputs.preference;
    if (preferenceOutput?.error) {
      appendError(LayersEnum.Preference, 'extract', preferenceOutput.error);
    }
    if (preferenceOutput?.data) {
      await persistWithSpan(LayersEnum.Preference, () =>
        this.persistPreferenceMemories(
          job,
          messageIds,
          preferenceOutput.data,
          runtimes.embeddings,
          this.modelConfig.embeddingsModel,
          this.embeddingContextLimit,
          db,
        ),
      );
    }

    const identityOutput = extraction.outputs.identity;
    if (identityOutput?.error) {
      appendError(LayersEnum.Identity, 'extract', identityOutput.error);
    }
    if (identityOutput?.data) {
      await persistWithSpan(LayersEnum.Identity, () =>
        this.persistIdentityMemories(
          job,
          messageIds,
          identityOutput.data,
          runtimes.embeddings,
          this.modelConfig.embeddingsModel,
          this.embeddingContextLimit,
          db,
        ),
      );
    }

    if (errors.length) {
      const detail = errors
        .map((error) => `${error.message}${error.cause ? `: ${error.cause}` : ''}`)
        .join('; ');
      throw new AggregateError(errors, `Memory extraction encountered layer errors: ${detail}`);
    }

    return {
      createdIds,
      layers: perLayer,
    };
  }

  private async getAiProviderRuntimeState(userId: string): Promise<AiProviderRuntimeState> {
    const db = await this.db;
    const aiInfraRepos = new AiInfraRepos(db, userId, this.aiProviderConfig);

    return aiInfraRepos.getAiProviderRuntimeState(KeyVaultsGateKeeper.getUserKeyVaults);
  }

  private async resolveRuntimeKeyVaults(
    runtimeState: AiProviderRuntimeState,
  ): Promise<ProviderKeyVaultMap> {
    const normalizedRuntimeConfig = Object.fromEntries(
      Object.entries(runtimeState.runtimeConfig || {}).map(([providerId, config]) => [
        normalizeProvider(providerId),
        config,
      ]),
    );

    const keyVaults: ProviderKeyVaultMap = {};

    const gatekeeperProvider = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
      fallbackProvider: this.privateConfig.agentGateKeeper.provider,
      label: 'gatekeeper',
      modelId: this.modelConfig.gateModel,
      preferredModels: this.gatekeeperPreferredModels,
      preferredProviders: this.gatekeeperPreferredProviders,
    });
    const gatekeeperRuntime = normalizedRuntimeConfig[gatekeeperProvider];
    if (gatekeeperRuntime?.keyVaults) {
      keyVaults[gatekeeperProvider] = gatekeeperRuntime.keyVaults;
    }

    const embeddingProvider = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
      fallbackProvider: this.privateConfig.embedding.provider,
      label: 'embedding',
      modelId: this.modelConfig.embeddingsModel,
      preferredModels: this.embeddingPreferredModels,
      preferredProviders: this.embeddingPreferredProviders,
    });
    const embeddingRuntime = normalizedRuntimeConfig[embeddingProvider];
    if (embeddingRuntime?.keyVaults) {
      keyVaults[embeddingProvider] = embeddingRuntime.keyVaults;
    }

    for (const model of Object.values(this.modelConfig.layerModels)) {
      if (!model) continue;
      const providerId = await AiInfraRepos.tryMatchingProviderFrom(runtimeState, {
        fallbackProvider: this.privateConfig.agentLayerExtractor.provider,
        label: 'layer extractor',
        modelId: model,
        preferredModels: this.layerPreferredModels,
        preferredProviders: this.layerPreferredProviders,
      });
      const runtime = normalizedRuntimeConfig[providerId];
      if (runtime?.keyVaults) {
        keyVaults[providerId] = runtime.keyVaults;
      }
    }

    return keyVaults;
  }

  private async getRuntime(
    userId: string,
    keyVaults?: ProviderKeyVaultMap,
  ): Promise<RuntimeBundle> {
    // TODO: implement a better cache eviction strategy
    // TODO: make cache size configurable
    if (this.runtimeCache.keys.length > 200) {
      this.runtimeCache.clear();
    }

    const cached = this.runtimeCache.get(userId);
    if (cached) return cached;

    const embeddingOptions: RuntimeResolveOptions = {
      fallback: {
        apiKey: this.privateConfig.embedding.apiKey,
        baseURL: this.privateConfig.embedding.baseURL,
      },
      preferred: { providerIds: this.embeddingPreferredProviders },
    };

    const gatekeeperOptions: RuntimeResolveOptions = {
      fallback: {
        apiKey: this.privateConfig.agentGateKeeper.apiKey,
        baseURL: this.privateConfig.agentGateKeeper.baseURL,
      },
      preferred: { providerIds: this.gatekeeperPreferredProviders },
    };

    const layerExtractorOptions: RuntimeResolveOptions = {
      fallback: {
        apiKey: this.privateConfig.agentLayerExtractor.apiKey,
        baseURL: this.privateConfig.agentLayerExtractor.baseURL,
      },
      preferred: { providerIds: this.layerPreferredProviders },
    };

    const runtimes: RuntimeBundle = {
      embeddings: await resolveRuntimeAgentConfig(
        { ...this.privateConfig.embedding },
        keyVaults,
        embeddingOptions,
      ),
      gatekeeper: await resolveRuntimeAgentConfig(
        { ...this.privateConfig.agentGateKeeper },
        keyVaults,
        gatekeeperOptions,
      ),
      layerExtractor: await resolveRuntimeAgentConfig(
        { ...this.privateConfig.agentLayerExtractor },
        keyVaults,
        layerExtractorOptions,
      ),
    };

    this.runtimeCache.set(userId, runtimes);

    return runtimes;
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
    const attributes = {
      source: params.source,
      source_id: params.sourceId,
      user_id: params.userId,
    };

    return tracer.startActiveSpan(
      'Memory User Memory: Extract Benchmark LoCoMo',
      { attributes },
      async (span) => {
        const startTime = Date.now();
        let extractionJob: MemoryExtractionJob | null = null;
        let extraction: MemoryExtractionResult | null = null;

        try {
          const db = await this.db;
          const userModel = new UserModel(db, params.userId);
          const [userState, aiProviderRuntimeState] = await Promise.all([
            userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults),
            this.getAiProviderRuntimeState(params.userId),
          ]);
          const keyVaults = await this.resolveRuntimeKeyVaults(aiProviderRuntimeState);
          const language = params.language || userState.settings?.general?.responseLanguage;

          const runtimes = await this.getRuntime(params.userId, keyVaults);
          const contextProvider =
            params.contextProvider ||
            new BenchmarkLocomoContextProvider({
              parts: params.parts,
              sampleId: params.sourceId,
              sourceId: params.sourceId,
              userId: params.userId,
            });

          const latestCreatedAt = params.parts.reduce<Date | undefined>((latest, part) => {
            if (!part.createdAt) return latest;

            const date = new Date(part.createdAt);
            if (Number.isNaN(date.getTime())) return latest;

            return !latest || date > latest ? date : latest;
          }, undefined);

          extractionJob = {
            force: params.forceAll ?? true,
            layers: params.layers,
            source: params.source,
            sourceId: params.sourceId,
            sourceUpdatedAt: latestCreatedAt ?? new Date(),
            userId: params.userId,
          };

          const builtContext = await contextProvider.buildContext(extractionJob.userId);
          const extractorContextLimit = this.privateConfig.agentLayerExtractor.contextLimit;
          const trimmedContext = await this.trimTextToTokenLimit(
            builtContext.context,
            extractorContextLimit,
          );

          const agentCalls: Partial<
            Record<
              MemoryExtractionAgent,
              MemoryExtractionAgentCallTrace<GenerateObjectPayload, unknown>
            >
          > = {};
          const agentStartedAt: Partial<Record<MemoryExtractionAgent, number>> = {};

          const recordRequest = (agent: MemoryExtractionAgent, request: GenerateObjectPayload) => {
            agentStartedAt[agent] = Date.now();
            agentCalls[agent] = { ...agentCalls[agent], request };
          };

          const recordResponse = (agent: MemoryExtractionAgent, response: unknown) => {
            const duration = agentStartedAt[agent]
              ? Date.now() - agentStartedAt[agent]!
              : undefined;
            agentCalls[agent] = { ...agentCalls[agent], durationMs: duration, response };
          };

          const recordError = (agent: MemoryExtractionAgent, error: unknown) => {
            const duration = agentStartedAt[agent]
              ? Date.now() - agentStartedAt[agent]!
              : undefined;
            agentCalls[agent] = {
              ...agentCalls[agent],
              durationMs: duration,
              error: serializeError(error),
            };
          };

          const service = new MemoryExtractionService({
            config: this.modelConfig,
            db,
            language,
            runtimes,
          });

          extraction = await service.run(extractionJob, {
            callbacks: {
              onExtractError: async (agent, error) => {
                recordError(agent, error);
              },
              onExtractRequest: async (agent, payload) => {
                recordRequest(agent, payload);
              },
              onExtractResponse: async (agent, response) => {
                recordResponse(agent, response);
              },
            },
            contextProvider,
            gatekeeperLanguage: this.privateConfig.agentGateKeeper.language || 'English',
            language,
            retrievedContexts: [trimmedContext],
            retrievedIdentitiesContext: undefined,
            sessionDate: (latestCreatedAt ?? new Date()).toISOString(),
            topK: 10,
            username:
              userState.fullName || `${userState.firstName} ${userState.lastName}`.trim() || 'User',
          });

          if (!extraction) {
            this.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
            span.setStatus({ code: SpanStatusCode.OK, message: 'no_extraction' });
            return {
              extracted: false,
              layers: {},
              memoryIds: [],
              traceId: span.spanContext().traceId,
            };
          }

          const persistedRes = await this.persistExtraction(
            extractionJob,
            [],
            extraction,
            runtimes,
            db,
          );

          this.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute('memory.persisted_count', persistedRes.createdIds.length);

          return {
            extracted: true,
            layers: persistedRes.layers,
            memoryIds: persistedRes.createdIds,
            traceId: span.spanContext().traceId,
          };
        } catch (error) {
          if (extractionJob) {
            this.recordJobMetrics(extractionJob, 'failed', Date.now() - startTime);
          }
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : 'Extraction failed',
          });
          span.recordException(error as Error);
          console.error(
            '[memory-extraction] benchmark extraction failed',
            error,
            'sourceId:',
            params.sourceId,
            'userId:',
            params.userId,
          );
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}

const WORKFLOW_PATHS = {
  personaUpdate: '/api/workflows/memory-user-memory/pipelines/persona/update-writing',
  topicBatch: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-topics',
  userTopics: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-user-topics',
  users: '/api/workflows/memory-user-memory/pipelines/chat-topic/process-users',
} as const;

const getWorkflowUrl = (path: string, baseUrl: string) => {
  const url = new URL(path, baseUrl);

  return url.toString();
};

const getWorkflowClient = () => {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is required to trigger workflows');

  const config: ConstructorParameters<typeof Client>[0] = { token };

  if (process.env.QSTASH_URL) {
    (config as Record<string, unknown>).url = process.env.QSTASH_URL;
  }

  return new Client(config);
};

export class MemoryExtractionWorkflowService {
  private static client: Client;

  private static getClient() {
    if (!this.client) {
      this.client = getWorkflowClient();
    }

    return this.client;
  }

  static triggerProcessUsers(
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.users, payload.baseUrl);
    return this.getClient().trigger({ body: payload, headers: options?.extraHeaders, url });
  }

  static triggerProcessUserTopics(
    payload: UserTopicWorkflowPayload,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.userTopics, payload.baseUrl);
    return this.getClient().trigger({
      body: payload,
      headers: options?.extraHeaders,
      url,
    });
  }

  static triggerProcessTopics(
    userId: string,
    payload: MemoryExtractionPayloadInput,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    if (!payload.baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.topicBatch, payload.baseUrl);
    return this.getClient().trigger({
      body: payload,
      flowControl: {
        key: `memory-user-memory.pipelines.chat-topic.process-topics.user.${userId}`,
        // NOTICE: if modified the parallelism of
        // src/app/(backend)/api/workflows/memory-user-memory/pipelines/chat-topic/process-topics/route.ts
        // or added new memory layer, make sure to update the number below.
        //
        // Currently, CEPA (context, experience, preference, activity) + identity = 5 layers.
        // and since identity requires sequential processing, we set parallelism to 5.
        parallelism: 5,
      },
      headers: options?.extraHeaders,
      url,
    });
  }

  static triggerPersonaUpdate(
    userId: string,
    baseUrl: string,
    options?: { extraHeaders?: Record<string, string> },
  ) {
    if (!baseUrl) {
      throw new Error('Missing baseUrl for workflow trigger');
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.personaUpdate, baseUrl);
    return this.getClient().trigger({
      body: { userIds: [userId] },
      flowControl: {
        key: `memory-user-memory.pipelines.persona.update-write.${userId}`,
        parallelism: 1,
      } satisfies FlowControl,
      headers: options?.extraHeaders,
      url,
    });
  }
}

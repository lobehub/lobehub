import { topics } from '@lobechat/database/schemas';
import type {
  MemoryExtractionAgent,
  MemoryExtractionJob,
  MemoryExtractionResult,
} from '@lobechat/memory-user-memory';
import {
  LobeChatTopicContextProvider,
  LobeChatTopicResultRecorder,
  MemoryExtractionService,
  RetrievalUserMemoryContextProvider,
  RetrievalUserMemoryIdentitiesProvider,
} from '@lobechat/memory-user-memory';
import type { GenerateObjectPayload } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/memory-user-memory';
import type {
  ChatTopicMetadata,
  MemoryExtractionAgentCallTrace,
  MemoryExtractionTracePayload,
  UserServiceModelConfig,
} from '@lobechat/types';
import { and, eq } from 'drizzle-orm';
import { join } from 'pathe';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { UserModel } from '@/database/models/user';
import type { UserMemoryHybridSearchAggregatedResult } from '@/database/models/userMemory';
import { UserMemoryModel } from '@/database/models/userMemory';
import { buildWorkspaceWhere } from '@/database/utils/workspace';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { S3 } from '@/server/modules/S3';
import { AsyncTaskStatus } from '@/types/asyncTask';

import type { MemoryExtractionExecutorContext } from './context';
import type { MemoryExtractionTaskErrorItem } from './errors';
import {
  buildAsyncTaskErrorFrom,
  makeTaskErrorItem,
  MemoryExtractionAggregateError,
  serializeError,
} from './errors';
import type { TopicExtractionJob } from './types';

const isTopicExtracted = (metadata?: ChatTopicMetadata | null): boolean => {
  const extractStatus = metadata?.userMemoryExtractStatus;
  if (extractStatus) return extractStatus === 'completed';

  return (
    metadata?.userMemoryExtractStatus === 'completed' &&
    !!metadata?.userMemoryExtractRunState?.lastRunAt
  );
};

export async function reportUserInitiatedProgress(
  ctx: MemoryExtractionExecutorContext,
  job: TopicExtractionJob,
) {
  if (!job.asyncTaskId || !job.userInitiated) return;

  try {
    const db = await ctx.db;
    const asyncTaskModel = new AsyncTaskModel(db, job.userId, job.workspaceId);
    await asyncTaskModel.incrementUserMemoryExtractionProgress(job.asyncTaskId);
  } catch (error) {
    console.error('[memory-extraction] failed to update async task progress', error);
  }
}

export async function extractTopic(ctx: MemoryExtractionExecutorContext, job: TopicExtractionJob) {
  const attributes = {
    source: job.source,
    source_id: job.topicId,
    user_id: job.userId,
  };

  let observabilityS3: S3 | undefined;
  if (ctx.modelConfig.observabilityS3?.enabled) {
    observabilityS3 = new S3(
      ctx.modelConfig.observabilityS3?.accessKeyId,
      ctx.modelConfig.observabilityS3?.secretAccessKey,
      ctx.modelConfig.observabilityS3?.endpoint,
      {
        bucket: ctx.modelConfig.observabilityS3?.bucketName,
        forcePathStyle: ctx.modelConfig.observabilityS3?.forcePathStyle,
        region: ctx.modelConfig.observabilityS3?.region,
        setAcl: false,
      },
    );
  }

  return tracer.startActiveSpan(
    'Memory User Memory: Extract Chat Topic',
    { attributes },
    async (span) => {
      const shouldReportProgress =
        job.reportProgress !== false && job.userInitiated && !!job.asyncTaskId;
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
        const db = await ctx.db;
        const topic = await db.query.topics.findFirst({
          columns: { createdAt: true, id: true, metadata: true, updatedAt: true, userId: true },
          where: and(
            eq(topics.id, job.topicId),
            buildWorkspaceWhere({ userId: job.userId, workspaceId: job.workspaceId }, topics),
          ),
        });

        if (!topic) {
          console.warn(`[memory-extraction] topic ${job.topicId} not found for user ${job.userId}`);
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
          ctx.getAiProviderRuntimeState(job.userId, job.workspaceId),
        ]);
        const memoryServiceConfig = ctx.resolveUserMemoryServiceConfig(
          userState.settings?.systemAgent as Partial<UserServiceModelConfig> | undefined,
        );
        const keyVaults = await ctx.resolveRuntimeKeyVaults(
          aiProviderRuntimeState,
          memoryServiceConfig,
        );
        const language = userState.settings?.general?.responseLanguage;

        const runtimes = await ctx.getRuntime(job.userId, memoryServiceConfig, keyVaults);

        const conversations = await ctx.listConversationsForTopic(
          job.userId,
          topic.id,
          topic.updatedAt,
          job.workspaceId,
        );
        if (!conversations || conversations.length === 0) {
          if (extractionJob) {
            ctx.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
          }
          span.setStatus({ code: SpanStatusCode.OK, message: 'empty_conversations' });
          return {
            extracted: false,
            layers: {},
            memoryIds: [],
            traceId: span.spanContext().traceId,
          };
        }

        const extractorContextLimit = memoryServiceConfig.extractorContextLimit;
        const embeddingContextLimit =
          memoryServiceConfig.embeddingContextLimit ?? extractorContextLimit;
        const extractorConversations = await ctx.trimConversationsToTokenLimit(
          conversations,
          extractorContextLimit,
        );
        const embeddingConversations = await ctx.trimConversationsToTokenLimit(
          conversations,
          embeddingContextLimit,
        );

        const messageIds = extractorConversations.map((item) => item.id);

        const topicContextProvider = new LobeChatTopicContextProvider({
          conversations: extractorConversations,
          topic,
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

        const retrievalErrors: MemoryExtractionTaskErrorItem[] = [];
        let searchResult: UserMemoryHybridSearchAggregatedResult = {
          activities: [],
          contexts: [],
          experiences: [],
          identities: [],
          meta: {
            appliedFilters: {},
            appliedQueries: [],
            layers: {
              activities: { hasMore: false, returned: 0, total: 0 },
              contexts: { hasMore: false, returned: 0, total: 0 },
              experiences: { hasMore: false, returned: 0, total: 0 },
              identities: { hasMore: false, returned: 0, total: 0 },
              preferences: { hasMore: false, returned: 0, total: 0 },
            },
            ranking: {},
          },
          preferences: [],
        };

        try {
          searchResult = await ctx.listRelevantUserMemories(
            extractionJob,
            runtimes.embeddings,
            memoryServiceConfig.modelConfig.embeddingsModel,
            job.userId,
            embeddingConversations,
            embeddingContextLimit,
          );
        } catch (error) {
          retrievalErrors.push(
            makeTaskErrorItem('retrieval', error, {
              preview: embeddingConversations.map((item) => item.content).join('\n\n'),
              sourceId: extractionJob.sourceId,
              sourceType: extractionJob.source,
            }),
          );
        }
        const retrievedMemoryContextProvider = new RetrievalUserMemoryContextProvider({
          retrievedMemories: {
            activities: searchResult.activities,
            contexts: searchResult.contexts,
            experiences: searchResult.experiences,
            preferences: searchResult.preferences,
          } as ConstructorParameters<
            typeof RetrievalUserMemoryContextProvider
          >[0]['retrievedMemories'],
        });
        const retrievalMemoryContext = await retrievedMemoryContextProvider.buildContext(
          extractionJob.userId,
          extractionJob.sourceId,
        );

        const retrievedMemoryIdentities = await ctx.listUserMemoryIdentities(
          extractionJob,
          job.userId,
        );
        const retrievedMemoryIdentitiesContextProvider = new RetrievalUserMemoryIdentitiesProvider({
          retrievedIdentities: retrievedMemoryIdentities,
        });
        const retrievedIdentityContext =
          await retrievedMemoryIdentitiesContextProvider.buildContext(
            extractionJob.userId,
            extractionJob.sourceId,
          );
        const trimmedRetrievedContexts = await Promise.all(
          [topicContext.context, retrievalMemoryContext.context].map((context) =>
            ctx.trimTextToTokenLimit(context, extractorContextLimit),
          ),
        );
        const trimmedRetrievedIdentitiesContext = await ctx.trimTextToTokenLimit(
          retrievedIdentityContext.context,
          extractorContextLimit,
        );
        const taxonomyOptions = await new UserMemoryModel(db, job.userId).queryTaxonomyOptions({
          include: ['categories', 'labels', 'tags'],
          limit: 20,
        });

        const agentCalls: Partial<
          Record<MemoryExtractionAgent, MemoryExtractionAgentCallTrace<GenerateObjectPayload>>
        > = {};
        const agentStartedAt: Partial<Record<MemoryExtractionAgent, number>> = {};

        const recordRequest = (agent: MemoryExtractionAgent, request: GenerateObjectPayload) => {
          agentStartedAt[agent] = Date.now();
          agentCalls[agent] = { ...agentCalls[agent], request };
        };

        const recordResponse = (agent: MemoryExtractionAgent, response: unknown) => {
          const duration = agentStartedAt[agent] ? Date.now() - agentStartedAt[agent]! : undefined;
          agentCalls[agent] = { ...agentCalls[agent], durationMs: duration, response };
        };

        const recordError = (agent: MemoryExtractionAgent, error: unknown) => {
          const duration = agentStartedAt[agent] ? Date.now() - agentStartedAt[agent]! : undefined;
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
            layers: searchResult,
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
          config: memoryServiceConfig.modelConfig,
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
          gatekeeperLanguage: ctx.privateConfig.agentGateKeeper.language || 'English',
          language,
          resultRecorder: resultRecorder as any,
          availableCategories: taxonomyOptions.categories.map((item) => item.value),
          availableLabels: taxonomyOptions.labels.map((item) => item.value),
          availableTags: taxonomyOptions.tags.map((item) => item.value),
          retrievedContexts: trimmedRetrievedContexts,
          retrievedIdentitiesContext: trimmedRetrievedIdentitiesContext,

          sessionDate: topic.updatedAt.toISOString(),
          // TODO: make topK configurable
          topK: 10,
          topicId: topic.id,
          username:
            userState.fullName || `${userState.firstName} ${userState.lastName}`.trim() || 'User',
        });
        if (!extraction) {
          ctx.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
          span.setStatus({ code: SpanStatusCode.OK, message: 'no_extraction' });
          topicProcessed = true;
          return {
            extracted: false,
            layers: {},
            memoryIds: [],
            traceId: span.spanContext().traceId,
          };
        }

        const persistedRes = await ctx.persistExtraction(
          extractionJob,
          messageIds,
          extraction,
          runtimes,
          memoryServiceConfig,
          db,
        );
        if (retrievalErrors.length > 0) {
          throw new MemoryExtractionAggregateError(
            'Memory extraction completed with retrieval errors',
            retrievalErrors,
          );
        }
        if (tracePayload) {
          tracePayload.result = { extraction, persisted: persistedRes };
        }
        await resultRecorder.recordComplete(extractionJob, {
          ...persistedRes,
          processedMemoryCount: persistedRes.createdIds.length,
        });
        ctx.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
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
          ctx.recordJobMetrics(extractionJob, 'failed', Date.now() - startTime);
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
            const asyncTaskModel = new AsyncTaskModel(await ctx.db, job.userId, job.workspaceId);
            await asyncTaskModel.update(job.asyncTaskId, {
              error: buildAsyncTaskErrorFrom(error),
              status: AsyncTaskStatus.Error,
            });
          } catch (taskError) {
            console.error('[memory-extraction] failed to update async task status', taskError);
          }
        }
        throw error;
      } finally {
        if (shouldReportProgress && topicProcessed) {
          await ctx.reportUserInitiatedProgress(job);
        }

        if (observabilityS3 && tracePayload) {
          try {
            await ctx.uploadExtractionTrace(
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

export function getOnExtractHooksPath(
  ctx: MemoryExtractionExecutorContext,
  userId: string,
  source: string,
  sourceId: string,
): string | undefined {
  if (!ctx.modelConfig.observabilityS3?.enabled) {
    return undefined;
  }

  const withoutBase = `memory-extraction/${userId}/${source}/${sourceId}/`;
  const base = ctx.modelConfig.observabilityS3?.pathPrefix
    ? ctx.modelConfig.observabilityS3?.pathPrefix.startsWith('/')
      ? ctx.modelConfig.observabilityS3?.pathPrefix.slice(1)
      : ctx.modelConfig.observabilityS3?.pathPrefix
    : '';

  const key = join(`${base}`, withoutBase);
  return key;
}

export async function uploadExtractionTrace(
  ctx: MemoryExtractionExecutorContext,
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
  if (!ctx.modelConfig.observabilityS3?.enabled) return;

  const key = join(
    ctx.getOnExtractHooksPath(userId, source, sourceId)!,
    'trace',
    `${new Date().toISOString()}.json`,
  );

  await s3.uploadContent(key, JSON.stringify(payload, null, 2));
}

import type {
  BenchmarkLocomoPart,
  MemoryExtractionAgent,
  MemoryExtractionJob,
  MemoryExtractionResult,
} from '@lobechat/memory-user-memory';
import {
  BenchmarkLocomoContextProvider,
  MemoryExtractionService,
} from '@lobechat/memory-user-memory';
import type { GenerateObjectPayload } from '@lobechat/model-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/memory-user-memory';
import type { MemoryExtractionAgentCallTrace, UserServiceModelConfig } from '@lobechat/types';

import { UserModel } from '@/database/models/user';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type { LayersEnum, MemorySourceType } from '@/types/userMemory';

import type { MemoryExtractionExecutorContext } from './context';
import { serializeError } from './errors';

export async function extractBenchmarkSource(
  ctx: MemoryExtractionExecutorContext,
  params: {
    contextProvider?: BenchmarkLocomoContextProvider;
    forceAll?: boolean;
    language?: string;
    layers?: LayersEnum[];
    parts: BenchmarkLocomoPart[];
    source: MemorySourceType;
    sourceId: string;
    userId: string;
  },
) {
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
      let extraction: MemoryExtractionResult | null;

      try {
        const db = await ctx.db;
        const userModel = new UserModel(db, params.userId);
        const [userState, aiProviderRuntimeState] = await Promise.all([
          userModel.getUserState(KeyVaultsGateKeeper.getUserKeyVaults),
          ctx.getAiProviderRuntimeState(params.userId),
        ]);
        const memoryServiceConfig = ctx.resolveUserMemoryServiceConfig(
          userState.settings?.systemAgent as Partial<UserServiceModelConfig> | undefined,
        );
        const keyVaults = await ctx.resolveRuntimeKeyVaults(
          aiProviderRuntimeState,
          memoryServiceConfig,
        );
        const language = params.language || userState.settings?.general?.responseLanguage;

        const runtimes = await ctx.getRuntime(params.userId, memoryServiceConfig, keyVaults);
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
        const extractorContextLimit = memoryServiceConfig.extractorContextLimit;
        const trimmedContext = await ctx.trimTextToTokenLimit(
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

        const service = new MemoryExtractionService({
          config: memoryServiceConfig.modelConfig,
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
          gatekeeperLanguage: ctx.privateConfig.agentGateKeeper.language || 'English',
          language,
          retrievedContexts: [trimmedContext],
          retrievedIdentitiesContext: undefined,
          sessionDate: (latestCreatedAt ?? new Date()).toISOString(),
          topK: 10,
          username:
            userState.fullName || `${userState.firstName} ${userState.lastName}`.trim() || 'User',
        });

        if (!extraction) {
          ctx.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
          span.setStatus({ code: SpanStatusCode.OK, message: 'no_extraction' });
          return {
            extracted: false,
            layers: {},
            memoryIds: [],
            traceId: span.spanContext().traceId,
          };
        }

        const persistedRes = await ctx.persistExtraction(
          extractionJob,
          [],
          extraction,
          runtimes,
          memoryServiceConfig,
          db,
        );

        ctx.recordJobMetrics(extractionJob, 'completed', Date.now() - startTime);
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
          ctx.recordJobMetrics(extractionJob, 'failed', Date.now() - startTime);
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

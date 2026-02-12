import { BRANDING_PROVIDER, ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  DEFAULT_SEARCH_USER_MEMORY_TOP_K,
  DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
  DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM,
} from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import {
  ActivityMemoryItemSchema,
  AddIdentityActionSchema,
  ContextMemoryItemSchema,
  ExperienceMemoryItemSchema,
  PreferenceMemoryItemSchema,
  RemoveIdentityActionSchema,
  UpdateIdentityActionSchema,
} from '@lobechat/memory-user-memory';
import { type SearchMemoryResult } from '@lobechat/types';
import { LayersEnum, searchMemorySchema } from '@lobechat/types';
import { type SQL } from 'drizzle-orm';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import {
  type IdentityEntryBasePayload,
  type IdentityEntryPayload,
} from '@/database/models/userMemory';
import {
  UserMemoryActivityModel,
  UserMemoryExperienceModel,
  UserMemoryIdentityModel,
  UserMemoryModel,
} from '@/database/models/userMemory';
import { UserMemoryTopicRepository } from '@/database/repositories/userMemory';
import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerDefaultFilesConfig } from '@/server/globalConfig';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

const EMPTY_SEARCH_RESULT: SearchMemoryResult = {
  activities: [],
  contexts: [],
  experiences: [],
  preferences: [],
};

type MemorySearchContext = {
  memoryModel: UserMemoryModel;
  serverDB: LobeChatDatabase;
  userId: string;
};

type MemorySearchResult = Awaited<ReturnType<UserMemoryModel['searchWithEmbedding']>>;

const mapMemorySearchResult = (layeredResults: MemorySearchResult): SearchMemoryResult => {
  return {
    activities: layeredResults.activities.map((activity) => ({
      accessedAt: activity.accessedAt,
      associatedLocations: activity.associatedLocations,
      associatedObjects: activity.associatedObjects,
      associatedSubjects: activity.associatedSubjects,
      capturedAt: activity.capturedAt,
      createdAt: activity.createdAt,
      endsAt: activity.endsAt,
      feedback: activity.feedback,
      id: activity.id,
      metadata: activity.metadata,
      narrative: activity.narrative,
      notes: activity.notes,
      startsAt: activity.startsAt,
      status: activity.status,
      tags: activity.tags,
      timezone: activity.timezone,
      type: activity.type,
      updatedAt: activity.updatedAt,
      userMemoryId: activity.userMemoryId,
    })),
    contexts: layeredResults.contexts.map((context) => ({
      accessedAt: context.accessedAt,
      associatedObjects: context.associatedObjects,
      associatedSubjects: context.associatedSubjects,
      createdAt: context.createdAt,
      currentStatus: context.currentStatus,
      description: context.description,
      id: context.id,
      metadata: context.metadata,
      scoreImpact: context.scoreImpact,
      scoreUrgency: context.scoreUrgency,
      tags: context.tags,
      title: context.title,
      type: context.type,
      updatedAt: context.updatedAt,
      userMemoryIds: Array.isArray(context.userMemoryIds)
        ? (context.userMemoryIds as string[])
        : null,
    })),
    experiences: layeredResults.experiences.map((experience) => ({
      accessedAt: experience.accessedAt,
      action: experience.action,
      createdAt: experience.createdAt,
      id: experience.id,
      keyLearning: experience.keyLearning,
      metadata: experience.metadata,
      possibleOutcome: experience.possibleOutcome,
      reasoning: experience.reasoning,
      scoreConfidence: experience.scoreConfidence,
      situation: experience.situation,
      tags: experience.tags,
      type: experience.type,
      updatedAt: experience.updatedAt,
      userMemoryId: experience.userMemoryId,
    })),
    preferences: layeredResults.preferences.map((preference) => ({
      accessedAt: preference.accessedAt,
      conclusionDirectives: preference.conclusionDirectives,
      createdAt: preference.createdAt,
      id: preference.id,
      metadata: preference.metadata,
      scorePriority: preference.scorePriority,
      suggestions: preference.suggestions,
      tags: preference.tags,
      type: preference.type,
      updatedAt: preference.updatedAt,
      userMemoryId: preference.userMemoryId,
    })),
  } satisfies SearchMemoryResult;
};

const searchUserMemories = async (
  ctx: MemorySearchContext,
  input: z.infer<typeof searchMemorySchema>,
): Promise<SearchMemoryResult> => {
  const { provider, model: embeddingModel } =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
  // Read user's provider config from database
  const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, provider);

  const queryEmbeddings = await modelRuntime.embeddings({
    dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
    input: input.query,
    model: embeddingModel,
  });

  const limits = {
    activities: input.topK?.activities ?? DEFAULT_SEARCH_USER_MEMORY_TOP_K.activities,
    contexts: input.topK?.contexts ?? DEFAULT_SEARCH_USER_MEMORY_TOP_K.contexts,
    experiences: input.topK?.experiences ?? DEFAULT_SEARCH_USER_MEMORY_TOP_K.experiences,
    preferences: input.topK?.preferences ?? DEFAULT_SEARCH_USER_MEMORY_TOP_K.preferences,
  };

  const layeredResults = await ctx.memoryModel.searchWithEmbedding({
    embedding: queryEmbeddings?.[0],
    limits,
  });

  return mapMemorySearchResult(layeredResults);
};

const getEmbeddingRuntime = async (serverDB: LobeChatDatabase, userId: string) => {
  const { provider, model: embeddingModel } =
    getServerDefaultFilesConfig().embeddingModel || DEFAULT_USER_MEMORY_EMBEDDING_MODEL_ITEM;
  // Read user's provider config from database
  const agentRuntime = await initModelRuntimeFromDB(
    serverDB,
    userId,
    ENABLE_BUSINESS_FEATURES ? BRANDING_PROVIDER : provider,
  );

  return { agentRuntime, embeddingModel };
};

const createEmbedder = (agentRuntime: any, embeddingModel: string) => {
  return async (value?: string | null): Promise<number[] | undefined> => {
    if (!value || value.trim().length === 0) return undefined;

    const embeddings = await agentRuntime.embeddings({
      dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
      input: value,
      model: embeddingModel,
    });

    return embeddings?.[0];
  };
};

const REEMBED_TABLE_KEYS = [
  'userMemories',
  'contexts',
  'preferences',
  'identities',
  'experiences',
  'activities',
] as const;
type ReEmbedTableKey = (typeof REEMBED_TABLE_KEYS)[number];

const reEmbedInputSchema = z.object({
  concurrency: z.coerce.number().int().min(1).max(50).optional(),
  endDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).optional(),
  only: z.array(z.enum(REEMBED_TABLE_KEYS)).optional(),
  startDate: z.coerce.date().optional(),
});

interface ReEmbedStats {
  failed: number;
  skipped: number;
  succeeded: number;
  total: number;
}

const combineConditions = (conditions: Array<SQL | undefined>): SQL | undefined => {
  const filtered = conditions.filter((condition): condition is SQL => condition !== undefined);
  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];

  return and(...filtered);
};

const normalizeEmbeddable = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
};

const memoryProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  return opts.next({
    ctx: {
      activityModel: new UserMemoryActivityModel(ctx.serverDB, ctx.userId),
      experienceModel: new UserMemoryExperienceModel(ctx.serverDB, ctx.userId),
      identityModel: new UserMemoryIdentityModel(ctx.serverDB, ctx.userId),
      memoryModel: new UserMemoryModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const userMemoriesRouter = router({
  getMemoryDetail: memoryProcedure
    .input(z.object({ id: z.string(), layer: z.nativeEnum(LayersEnum) }))
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.memoryModel.getMemoryDetail(input);
      } catch (error) {
        console.error('Failed to retrieve memory detail:', error);
        return null;
      }
    }),

  queryActivities: memoryProcedure
    .input(
      z
        .object({
          order: z.enum(['asc', 'desc']).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().optional(),
          sort: z.enum(['capturedAt', 'startsAt']).optional(),
          status: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const params = input ?? {};
      const fallbackPage = params.page ?? 1;
      const fallbackPageSize = params.pageSize ?? 20;

      try {
        return await ctx.activityModel.queryList(params);
      } catch (error) {
        console.error('Failed to query activities:', error);
        return { items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0 };
      }
    }),

  queryExperiences: memoryProcedure
    .input(
      z
        .object({
          order: z.enum(['asc', 'desc']).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().optional(),
          sort: z.enum(['capturedAt', 'scoreConfidence']).optional(),
          tags: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const params = input ?? {};
      const fallbackPage = params.page ?? 1;
      const fallbackPageSize = params.pageSize ?? 20;

      try {
        return await ctx.experienceModel.queryList(params);
      } catch (error) {
        console.error('Failed to query experiences:', error);
        return { items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0 };
      }
    }),

  queryIdentities: memoryProcedure
    .input(
      z
        .object({
          order: z.enum(['asc', 'desc']).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().optional(),
          relationships: z.array(z.string()).optional(),
          sort: z.enum(['capturedAt', 'type']).optional(),
          tags: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const params = input ?? {};
      const fallbackPage = params.page ?? 1;
      const fallbackPageSize = params.pageSize ?? 20;

      try {
        return await ctx.identityModel.queryList(params);
      } catch (error) {
        console.error('Failed to query identities:', error);
        return { items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0 };
      }
    }),

  queryIdentitiesForInjection: memoryProcedure
    .input(z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.identityModel.queryForInjection(input?.limit ?? 50);
      } catch (error) {
        console.error('Failed to query identities for injection:', error);
        return [];
      }
    }),

  queryIdentityRoles: memoryProcedure
    .input(
      z
        .object({
          page: z.coerce.number().int().min(1).optional(),
          size: z.coerce.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.memoryModel.queryIdentityRoles(input ?? {});
      } catch (error) {
        console.error('Failed to query identity roles:', error);
        return { roles: [], tags: [] };
      }
    }),

  queryMemories: memoryProcedure
    .input(
      z
        .object({
          categories: z.array(z.string()).optional(),
          layer: z.nativeEnum(LayersEnum).optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.coerce.number().int().min(1).optional(),
          pageSize: z.coerce.number().int().min(1).max(100).optional(),
          q: z.string().optional(),
          sort: z
            .enum([
              'capturedAt',
              'scoreConfidence',
              'scoreImpact',
              'scorePriority',
              'scoreUrgency',
              'startsAt',
            ])
            .optional(),
          status: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          types: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const params = input ?? {};
      const fallbackPage = params.page ?? 1;
      const fallbackPageSize = params.pageSize ?? 20;

      try {
        return await ctx.memoryModel.queryMemories({
          ...params,
          order: params.order ?? 'desc',
          sort: params.sort,
        });
      } catch (error) {
        console.error('Failed to query memories:', error);
        return { items: [], page: fallbackPage, pageSize: fallbackPageSize, total: 0 };
      }
    }),

  queryTags: memoryProcedure
    .input(
      z
        .object({
          layers: z.array(z.nativeEnum(LayersEnum)).optional(),
          page: z.coerce.number().int().min(1).optional(),
          size: z.coerce.number().int().min(1).max(100).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.memoryModel.queryTags(input ?? {});
      } catch (error) {
        console.error('Failed to query memory tags:', error);
        return [];
      }
    }),

  reEmbedMemories: memoryProcedure
    .input(reEmbedInputSchema.optional())
    .mutation(async ({ ctx, input }) => {
      try {
        const options = input ?? {};
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const concurrency = options.concurrency ?? 10;
        const shouldProcess = (key: ReEmbedTableKey) =>
          !options.only || options.only.length === 0 || options.only.includes(key);

        const embedTexts = async (texts: string[]): Promise<number[][]> => {
          if (texts.length === 0) return [];

          const response = await agentRuntime.embeddings({
            dimensions: DEFAULT_USER_MEMORY_EMBEDDING_DIMENSIONS,
            input: texts,
            model: embeddingModel,
          });

          if (!response || response.length !== texts.length) {
            throw new Error('Embedding response length mismatch');
          }

          return response;
        };

        const results: Partial<Record<ReEmbedTableKey, ReEmbedStats>> = {};

        const run = async (key: ReEmbedTableKey, handler: () => Promise<ReEmbedStats>) => {
          if (!shouldProcess(key)) return;
          results[key] = await handler();
        };

        // Individual re-embed handlers are appended below.
        await run('userMemories', async () => {
          const where = combineConditions([
            eq(userMemories.userId, ctx.userId),
            options.startDate ? gte(userMemories.createdAt, options.startDate) : undefined,
            options.endDate ? lte(userMemories.createdAt, options.endDate) : undefined,
          ]);

          const rows = await ctx.serverDB.query.userMemories.findMany({
            columns: { details: true, id: true, summary: true },
            limit: options.limit,
            orderBy: [asc(userMemories.createdAt)],
            where,
          });

          let succeeded = 0;
          let failed = 0;
          let skipped = 0;

          await pMap(
            rows,
            async (row) => {
              const summaryText = normalizeEmbeddable(row.summary);
              const detailsText = normalizeEmbeddable(row.details);

              try {
                if (!summaryText && !detailsText) {
                  await ctx.memoryModel.updateUserMemoryVectors(row.id, {
                    detailsVector1024: null,
                    summaryVector1024: null,
                  });
                  skipped += 1;
                  return;
                }

                const inputs: string[] = [];
                if (summaryText) inputs.push(summaryText);
                if (detailsText) inputs.push(detailsText);

                const embeddings = await embedTexts(inputs);
                let embedIndex = 0;

                const summaryVector = summaryText ? (embeddings[embedIndex++] ?? null) : null;
                const detailsVector = detailsText ? (embeddings[embedIndex++] ?? null) : null;

                await ctx.memoryModel.updateUserMemoryVectors(row.id, {
                  detailsVector1024: detailsVector,
                  summaryVector1024: summaryVector,
                });

                succeeded += 1;
              } catch (err) {
                failed += 1;
                console.error(
                  `[memoryRouter.reEmbed] Failed to re-embed user memory ${row.id}`,
                  err,
                );
              }
            },
            { concurrency },
          );

          return {
            failed,
            skipped,
            succeeded,
            total: rows.length,
          } satisfies ReEmbedStats;
        });

        await run('contexts', async () => {
          const where = combineConditions([
            eq(userMemoriesContexts.userId, ctx.userId),
            options.startDate ? gte(userMemoriesContexts.createdAt, options.startDate) : undefined,
            options.endDate ? lte(userMemoriesContexts.createdAt, options.endDate) : undefined,
          ]);

          const rows = await ctx.serverDB.query.userMemoriesContexts.findMany({
            columns: { description: true, id: true },
            limit: options.limit,
            orderBy: [asc(userMemoriesContexts.createdAt)],
            where,
          });

          let succeeded = 0;
          let failed = 0;
          let skipped = 0;

          await pMap(
            rows,
            async (row) => {
              const description = normalizeEmbeddable(row.description);

              try {
                if (!description) {
                  await ctx.memoryModel.updateContextVectors(row.id, {
                    descriptionVector: null,
                  });
                  skipped += 1;
                  return;
                }

                const [embedding] = await embedTexts([description]);

                await ctx.memoryModel.updateContextVectors(row.id, {
                  descriptionVector: embedding ?? null,
                });
                succeeded += 1;
              } catch (err) {
                failed += 1;
                console.error(`[memoryRouter.reEmbed] Failed to re-embed context ${row.id}`, err);
              }
            },
            { concurrency },
          );

          return {
            failed,
            skipped,
            succeeded,
            total: rows.length,
          } satisfies ReEmbedStats;
        });

        await run('preferences', async () => {
          const where = combineConditions([
            eq(userMemoriesPreferences.userId, ctx.userId),
            options.startDate
              ? gte(userMemoriesPreferences.createdAt, options.startDate)
              : undefined,
            options.endDate ? lte(userMemoriesPreferences.createdAt, options.endDate) : undefined,
          ]);

          const rows = await ctx.serverDB.query.userMemoriesPreferences.findMany({
            columns: { conclusionDirectives: true, id: true },
            limit: options.limit,
            orderBy: [asc(userMemoriesPreferences.createdAt)],
            where,
          });

          let succeeded = 0;
          let failed = 0;
          let skipped = 0;

          await pMap(
            rows,
            async (row) => {
              const directives = normalizeEmbeddable(row.conclusionDirectives);

              try {
                if (!directives) {
                  await ctx.memoryModel.updatePreferenceVectors(row.id, {
                    conclusionDirectivesVector: null,
                  });
                  skipped += 1;
                  return;
                }

                const [embedding] = await embedTexts([directives]);
                await ctx.memoryModel.updatePreferenceVectors(row.id, {
                  conclusionDirectivesVector: embedding ?? null,
                });
                succeeded += 1;
              } catch (err) {
                failed += 1;
                console.error(
                  `[memoryRouter.reEmbed] Failed to re-embed preference ${row.id}`,
                  err,
                );
              }
            },
            { concurrency },
          );

          return {
            failed,
            skipped,
            succeeded,
            total: rows.length,
          } satisfies ReEmbedStats;
        });

        await run('identities', async () => {
          const where = combineConditions([
            eq(userMemoriesIdentities.userId, ctx.userId),
            options.startDate
              ? gte(userMemoriesIdentities.createdAt, options.startDate)
              : undefined,
            options.endDate ? lte(userMemoriesIdentities.createdAt, options.endDate) : undefined,
          ]);

          const rows = await ctx.serverDB.query.userMemoriesIdentities.findMany({
            columns: { description: true, id: true },
            limit: options.limit,
            orderBy: [asc(userMemoriesIdentities.createdAt)],
            where,
          });

          let succeeded = 0;
          let failed = 0;
          let skipped = 0;

          await pMap(
            rows,
            async (row) => {
              const description = normalizeEmbeddable(row.description);

              try {
                if (!description) {
                  await ctx.memoryModel.updateIdentityVectors(row.id, {
                    descriptionVector: null,
                  });
                  skipped += 1;
                  return;
                }

                const [embedding] = await embedTexts([description]);
                await ctx.memoryModel.updateIdentityVectors(row.id, {
                  descriptionVector: embedding ?? null,
                });
                succeeded += 1;
              } catch (err) {
                failed += 1;
                console.error(`[memoryRouter.reEmbed] Failed to re-embed identity ${row.id}`, err);
              }
            },
            { concurrency },
          );

          return {
            failed,
            skipped,
            succeeded,
            total: rows.length,
          } satisfies ReEmbedStats;
        });

        await run('activities', async () => {
          const where = combineConditions([
            eq(userMemoriesActivities.userId, ctx.userId),
            options.startDate
              ? gte(userMemoriesActivities.createdAt, options.startDate)
              : undefined,
            options.endDate ? lte(userMemoriesActivities.createdAt, options.endDate) : undefined,
          ]);

          const rows = await ctx.serverDB.query.userMemoriesActivities.findMany({
            columns: { feedback: true, id: true, narrative: true },
            limit: options.limit,
            orderBy: [asc(userMemoriesActivities.createdAt)],
            where,
          });

          let succeeded = 0;
          let failed = 0;
          let skipped = 0;

          await pMap(
            rows,
            async (row) => {
              const narrative = normalizeEmbeddable(row.narrative);
              const feedback = normalizeEmbeddable(row.feedback);

              try {
                if (!narrative && !feedback) {
                  await ctx.memoryModel.updateActivityVectors(row.id, {
                    feedbackVector: null,
                    narrativeVector: null,
                  });
                  skipped += 1;
                  return;
                }

                const inputs: string[] = [];
                if (narrative) inputs.push(narrative);
                if (feedback) inputs.push(feedback);

                const embeddings = await embedTexts(inputs);
                let embedIndex = 0;

                const narrativeVector = narrative ? (embeddings[embedIndex++] ?? null) : null;
                const feedbackVector = feedback ? (embeddings[embedIndex++] ?? null) : null;

                await ctx.memoryModel.updateActivityVectors(row.id, {
                  feedbackVector,
                  narrativeVector,
                });
                succeeded += 1;
              } catch (err) {
                failed += 1;
                console.error(`[memoryRouter.reEmbed] Failed to re-embed activity ${row.id}`, err);
              }
            },
            { concurrency },
          );

          return {
            failed,
            skipped,
            succeeded,
            total: rows.length,
          } satisfies ReEmbedStats;
        });

        await run('experiences', async () => {
          const where = combineConditions([
            eq(userMemoriesExperiences.userId, ctx.userId),
            options.startDate
              ? gte(userMemoriesExperiences.createdAt, options.startDate)
              : undefined,
            options.endDate ? lte(userMemoriesExperiences.createdAt, options.endDate) : undefined,
          ]);

          const rows = await ctx.serverDB.query.userMemoriesExperiences.findMany({
            columns: { action: true, id: true, keyLearning: true, situation: true },
            limit: options.limit,
            orderBy: [asc(userMemoriesExperiences.createdAt)],
            where,
          });

          let succeeded = 0;
          let failed = 0;
          let skipped = 0;

          await pMap(
            rows,
            async (row) => {
              const situation = normalizeEmbeddable(row.situation);
              const action = normalizeEmbeddable(row.action);
              const keyLearning = normalizeEmbeddable(row.keyLearning);

              try {
                if (!situation && !action && !keyLearning) {
                  await ctx.memoryModel.updateExperienceVectors(row.id, {
                    actionVector: null,
                    keyLearningVector: null,
                    situationVector: null,
                  });
                  skipped += 1;
                  return;
                }

                const inputs: string[] = [];
                if (situation) inputs.push(situation);
                if (action) inputs.push(action);
                if (keyLearning) inputs.push(keyLearning);

                const embeddings = await embedTexts(inputs);
                let embedIndex = 0;

                const situationVector = situation ? (embeddings[embedIndex++] ?? null) : null;
                const actionVector = action ? (embeddings[embedIndex++] ?? null) : null;
                const keyLearningVector = keyLearning ? (embeddings[embedIndex++] ?? null) : null;

                await ctx.memoryModel.updateExperienceVectors(row.id, {
                  actionVector,
                  keyLearningVector,
                  situationVector,
                });
                succeeded += 1;
              } catch (err) {
                failed += 1;
                console.error(
                  `[memoryRouter.reEmbed] Failed to re-embed experience ${row.id}`,
                  err,
                );
              }
            },
            { concurrency },
          );

          return {
            failed,
            skipped,
            succeeded,
            total: rows.length,
          } satisfies ReEmbedStats;
        });

        const processedEntries = Object.entries(results) as Array<[ReEmbedTableKey, ReEmbedStats]>;

        if (processedEntries.length === 0) {
          return {
            message: 'No memory records matched re-embed criteria',
            results,
            success: true,
          };
        }

        const aggregate = processedEntries.reduce(
          (acc, [, stats]) => {
            acc.failed += stats.failed;
            acc.skipped += stats.skipped;
            acc.succeeded += stats.succeeded;
            acc.total += stats.total;

            return acc;
          },
          { failed: 0, skipped: 0, succeeded: 0, total: 0 },
        );

        const message =
          aggregate.total === 0
            ? 'No memory records required re-embedding'
            : `Re-embedded ${aggregate.succeeded} of ${aggregate.total} records`;

        return {
          aggregate,
          message,
          results,
          success: true,
        };
      } catch (error) {
        console.error('Failed to re-embed memories:', error);
        return {
          message: `Failed to re-embed memories: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  /**
   * Retrieve memories for a specific topic
   * Uses concatenated user messages (first 7000 chars) as the search query
   */
  retrieveMemoryForTopic: memoryProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ ctx, input }) => {
      try {
        // Get concatenated user messages for this topic
        const userMemoryTopicRepo = new UserMemoryTopicRepository(ctx.serverDB, ctx.userId);
        const query = await userMemoryTopicRepo.getUserMessagesQueryForTopic(input.topicId);

        if (!query) {
          // No user messages available, return empty result
          return EMPTY_SEARCH_RESULT;
        }

        // Search memories using concatenated user messages
        const searchParams = {
          query,
          topK: DEFAULT_SEARCH_USER_MEMORY_TOP_K,
        };

        const result = await searchUserMemories(ctx, searchParams);
        return result;
      } catch (error) {
        console.error('Failed to retrieve memory for topic:', error);
        return EMPTY_SEARCH_RESULT;
      }
    }),

  searchMemory: memoryProcedure.input(searchMemorySchema).query(async ({ input, ctx }) => {
    try {
      return await searchUserMemories(ctx, input);
    } catch (error) {
      console.error('Failed to retrieve memories:', error);
      return EMPTY_SEARCH_RESULT;
    }
  }),

  toolAddActivityMemory: memoryProcedure
    .input(ActivityMemoryItemSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const embed = createEmbedder(agentRuntime, embeddingModel);

        const summaryEmbedding = await embed(input.summary);
        const detailsEmbedding = await embed(input.details);
        const narrativeVector = await embed(input.withActivity.narrative);
        const feedbackVector = await embed(input.withActivity.feedback);

        const { activity, memory } = await ctx.memoryModel.createActivityMemory({
          activity: {
            associatedLocations:
              UserMemoryModel.parseAssociatedLocations(input.withActivity.associatedLocations) ??
              null,
            associatedObjects:
              UserMemoryModel.parseAssociatedObjects(input.withActivity.associatedObjects) ?? [],
            associatedSubjects:
              UserMemoryModel.parseAssociatedSubjects(input.withActivity.associatedSubjects) ?? [],
            endsAt: UserMemoryModel.parseDateFromString(input.withActivity.endsAt ?? undefined),
            feedback: input.withActivity.feedback ?? null,
            feedbackVector: feedbackVector ?? null,
            metadata: input.withActivity.metadata ?? null,
            narrative: input.withActivity.narrative ?? null,
            narrativeVector: narrativeVector ?? null,
            notes: input.withActivity.notes ?? null,
            startsAt: UserMemoryModel.parseDateFromString(input.withActivity.startsAt ?? undefined),
            status: input.withActivity.status ?? 'pending',
            tags: input.withActivity.tags ?? input.tags ?? [],
            timezone: input.withActivity.timezone ?? null,
            type: input.withActivity.type ?? 'other',
          },
          details: input.details || '',
          detailsEmbedding,
          memoryCategory: input.memoryCategory,
          memoryLayer: LayersEnum.Activity,
          memoryType: input.memoryType,
          summary: input.summary,
          summaryEmbedding,
          title: input.title,
        });

        return {
          activityId: activity.id,
          memoryId: memory.id,
          message: 'Memory saved successfully',
          success: true,
        };
      } catch (error) {
        console.error('Failed to save memory:', error);
        return {
          message: `Failed to save memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  toolAddContextMemory: memoryProcedure
    .input(ContextMemoryItemSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const embed = createEmbedder(agentRuntime, embeddingModel);

        const summaryEmbedding = await embed(input.summary);
        const detailsEmbedding = await embed(input.details);
        const contextDescriptionEmbedding = await embed(input.withContext.description);

        const { context, memory } = await ctx.memoryModel.createContextMemory({
          context: {
            associatedObjects:
              UserMemoryModel.parseAssociatedObjects(input.withContext.associatedObjects) ?? null,
            associatedSubjects:
              UserMemoryModel.parseAssociatedSubjects(input.withContext.associatedSubjects) ?? null,
            currentStatus: input.withContext.currentStatus ?? null,
            description: input.withContext.description ?? null,
            descriptionVector: contextDescriptionEmbedding ?? null,
            metadata: {},
            scoreImpact: input.withContext.scoreImpact ?? null,
            scoreUrgency: input.withContext.scoreUrgency ?? null,
            tags: input.tags ?? [],
            title: input.withContext.title ?? null,
            type: input.withContext.type ?? null,
          },
          details: input.details || '',
          detailsEmbedding,
          memoryCategory: input.memoryCategory,
          memoryLayer: LayersEnum.Context,
          memoryType: input.memoryType,
          summary: input.summary,
          summaryEmbedding,
          title: input.title,
        });

        return {
          contextId: context.id,
          memoryId: memory.id,
          message: 'Memory saved successfully',
          success: true,
        };
      } catch (error) {
        console.error('Failed to save memory:', error);
        return {
          message: `Failed to save memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  toolAddExperienceMemory: memoryProcedure
    .input(ExperienceMemoryItemSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const embed = createEmbedder(agentRuntime, embeddingModel);

        const summaryEmbedding = await embed(input.summary);
        const detailsEmbedding = await embed(input.details);
        const situationVector = await embed(input.withExperience.situation);
        const actionVector = await embed(input.withExperience.action);
        const keyLearningVector = await embed(input.withExperience.keyLearning);

        const { experience, memory } = await ctx.memoryModel.createExperienceMemory({
          details: input.details || '',
          detailsEmbedding,
          experience: {
            action: input.withExperience.action ?? null,
            actionVector: actionVector ?? null,
            keyLearning: input.withExperience.keyLearning ?? null,
            keyLearningVector: keyLearningVector ?? null,
            metadata: {},
            possibleOutcome: input.withExperience.possibleOutcome ?? null,
            reasoning: input.withExperience.reasoning ?? null,
            scoreConfidence: input.withExperience.scoreConfidence ?? null,
            situation: input.withExperience.situation ?? null,
            situationVector: situationVector ?? null,
            tags: input.tags ?? [],
            type: input.memoryType,
          },
          memoryCategory: input.memoryCategory,
          memoryLayer: LayersEnum.Experience,
          memoryType: input.memoryType,
          summary: input.summary,
          summaryEmbedding,
          title: input.title,
        });

        return {
          experienceId: experience.id,
          memoryId: memory.id,
          message: 'Memory saved successfully',
          success: true,
        };
      } catch (error) {
        console.error('Failed to save memory:', error);
        return {
          message: `Failed to save memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  toolAddIdentityMemory: memoryProcedure
    .input(AddIdentityActionSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const embed = createEmbedder(agentRuntime, embeddingModel);

        const summaryEmbedding = await embed(input.summary);
        const detailsEmbedding = await embed(input.details);
        const descriptionEmbedding = await embed(input.withIdentity.description);

        const identityMetadata: Record<string, unknown> = {};
        if (
          input.withIdentity.scoreConfidence !== null &&
          input.withIdentity.scoreConfidence !== undefined
        ) {
          identityMetadata.scoreConfidence = input.withIdentity.scoreConfidence;
        }
        if (
          input.withIdentity.sourceEvidence !== null &&
          input.withIdentity.sourceEvidence !== undefined
        ) {
          identityMetadata.sourceEvidence = input.withIdentity.sourceEvidence;
        }

        const { identityId, userMemoryId } = await ctx.memoryModel.addIdentityEntry({
          base: {
            details: input.details,
            detailsVector1024: detailsEmbedding ?? null,
            memoryCategory: input.memoryCategory,
            memoryLayer: LayersEnum.Identity,
            memoryType: input.memoryType,
            metadata: Object.keys(identityMetadata).length > 0 ? identityMetadata : undefined,
            summary: input.summary,
            summaryVector1024: summaryEmbedding ?? null,
            tags: input.tags,
            title: input.title,
          },
          identity: {
            description: input.withIdentity.description,
            descriptionVector: descriptionEmbedding ?? null,
            episodicDate: input.withIdentity.episodicDate,
            metadata: Object.keys(identityMetadata).length > 0 ? identityMetadata : undefined,
            relationship: input.withIdentity.relationship,
            role: input.withIdentity.role,
            tags: input.tags,
            type: input.withIdentity.type,
          },
        });

        return {
          identityId,
          memoryId: userMemoryId,
          message: 'Identity memory saved successfully',
          success: true,
        };
      } catch (error) {
        console.error('Failed to save identity memory:', error);
        return {
          message: `Failed to save identity memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  toolAddPreferenceMemory: memoryProcedure
    .input(PreferenceMemoryItemSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const embed = createEmbedder(agentRuntime, embeddingModel);

        const summaryEmbedding = await embed(input.summary);
        const detailsEmbedding = await embed(input.details);
        const conclusionVector = await embed(input.withPreference.conclusionDirectives);

        const suggestionsText =
          input.withPreference?.suggestions?.length && input.withPreference?.suggestions?.length > 0
            ? input.withPreference?.suggestions?.join('\n')
            : null;

        const metadata = {
          appContext: input.withPreference.appContext,
          extractedScopes: input.withPreference.extractedScopes,
          originContext: input.withPreference.originContext,
        } satisfies Record<string, unknown>;

        const { memory, preference } = await ctx.memoryModel.createPreferenceMemory({
          details: input.details || '',
          detailsEmbedding,
          memoryCategory: input.memoryCategory,
          memoryLayer: LayersEnum.Preference,
          memoryType: input.memoryType,
          preference: {
            conclusionDirectives: input.withPreference.conclusionDirectives || '',
            conclusionDirectivesVector: conclusionVector ?? null,
            metadata,
            scorePriority: input.withPreference.scorePriority ?? null,
            suggestions: suggestionsText,
            tags: input.tags,
            type: input.memoryType,
          },
          summary: input.summary,
          summaryEmbedding,
          title: input.title,
        });

        return {
          memoryId: memory.id,
          message: 'Memory saved successfully',
          preferenceId: preference.id,
          success: true,
        };
      } catch (error) {
        console.error('Failed to save memory:', error);
        return {
          message: `Failed to save memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  toolRemoveIdentityMemory: memoryProcedure
    .input(RemoveIdentityActionSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const removed = await ctx.memoryModel.removeIdentityEntry(input.id);

        if (!removed) {
          return {
            message: 'Identity memory not found',
            success: false,
          };
        }

        return {
          identityId: input.id,
          message: 'Identity memory removed successfully',
          reason: input.reason,
          success: true,
        };
      } catch (error) {
        console.error('Failed to remove identity memory:', error);
        return {
          message: `Failed to remove identity memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),

  toolSearchMemory: memoryProcedure.input(searchMemorySchema).query(async ({ input, ctx }) => {
    const result = await searchUserMemories(ctx, input);
    return result;
  }),

  toolUpdateIdentityMemory: memoryProcedure
    .input(UpdateIdentityActionSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { agentRuntime, embeddingModel } = await getEmbeddingRuntime(
          ctx.serverDB,
          ctx.userId,
        );
        const embed = createEmbedder(agentRuntime, embeddingModel);

        let summaryVector1024: number[] | null | undefined;
        if (input.set.summary !== undefined) {
          const vector = await embed(input.set.summary);
          summaryVector1024 = vector ?? null;
        }

        let detailsVector1024: number[] | null | undefined;
        if (input.set.details !== undefined) {
          const vector = await embed(input.set.details);
          detailsVector1024 = vector ?? null;
        }

        let descriptionVector: number[] | null | undefined;
        if (input.set.withIdentity.description !== undefined) {
          const vector = await embed(input.set.withIdentity.description);
          descriptionVector = vector ?? null;
        }

        const metadataUpdates: Record<string, unknown> = {};
        if (Object.hasOwn(input.set.withIdentity, 'scoreConfidence')) {
          metadataUpdates.scoreConfidence = input.set.withIdentity.scoreConfidence ?? null;
        }
        if (Object.hasOwn(input.set.withIdentity, 'sourceEvidence')) {
          metadataUpdates.sourceEvidence = input.set.withIdentity.sourceEvidence ?? null;
        }

        const identityPayload: Partial<IdentityEntryPayload> = {};
        if (input.set.withIdentity.description !== undefined) {
          identityPayload.description = input.set.withIdentity.description;
          identityPayload.descriptionVector = descriptionVector;
        }
        if (input.set.withIdentity.episodicDate !== undefined) {
          identityPayload.episodicDate = input.set.withIdentity.episodicDate;
        }
        if (input.set.withIdentity.relationship !== undefined) {
          identityPayload.relationship = input.set.withIdentity.relationship;
        }
        if (input.set.withIdentity.role !== undefined) {
          identityPayload.role = input.set.withIdentity.role;
        }
        if (input.set.tags !== undefined) {
          identityPayload.tags = input.set.tags;
        }
        if (input.set.withIdentity.type !== undefined) {
          identityPayload.type = input.set.withIdentity.type;
        }
        if (Object.keys(metadataUpdates).length > 0) {
          identityPayload.metadata = metadataUpdates;
        }

        const basePayload: Partial<IdentityEntryBasePayload> = {};
        if (input.set.details !== undefined) {
          basePayload.details = input.set.details;
          basePayload.detailsVector1024 = detailsVector1024;
        }
        if (input.set.memoryCategory !== undefined) {
          basePayload.memoryCategory = input.set.memoryCategory;
        }
        if (input.set.memoryType !== undefined) {
          basePayload.memoryType = input.set.memoryType;
        }
        if (input.set.summary !== undefined) {
          basePayload.summary = input.set.summary;
          basePayload.summaryVector1024 = summaryVector1024;
        }
        if (input.set.tags !== undefined) {
          basePayload.tags = input.set.tags;
        }
        if (input.set.title !== undefined) {
          basePayload.title = input.set.title;
        }
        if (Object.keys(metadataUpdates).length > 0) {
          basePayload.metadata = metadataUpdates;
        }

        const updated = await ctx.memoryModel.updateIdentityEntry({
          base: Object.keys(basePayload).length > 0 ? basePayload : undefined,
          identity: Object.keys(identityPayload).length > 0 ? identityPayload : undefined,
          identityId: input.id,
          mergeStrategy: input.mergeStrategy,
        });

        if (!updated) {
          return {
            message: 'Identity memory not found',
            success: false,
          };
        }

        return {
          identityId: input.id,
          message: 'Identity memory updated successfully',
          success: true,
        };
      } catch (error) {
        console.error('Failed to update identity memory:', error);
        return {
          message: `Failed to update identity memory: ${(error as Error).message}`,
          success: false,
        };
      }
    }),
});

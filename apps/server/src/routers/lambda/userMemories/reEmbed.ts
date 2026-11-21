import { type SQL } from 'drizzle-orm';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesExperiences,
  userMemoriesIdentities,
  userMemoriesPreferences,
} from '@/database/schemas';
import { notTrashed } from '@/database/utils/softDelete';
import { router } from '@/libs/trpc/lambda';
import { embedUserMemoryTexts } from '@/server/services/memory/userMemory/embedding';

import { memoryWriteProcedure } from './procedures';
import { getEmbeddingRuntime } from './utils';

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

export const reEmbedRouter = router({
  reEmbedMemories: memoryWriteProcedure
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

          const response = await embedUserMemoryTexts({
            input: texts,
            model: embeddingModel,
            runtime: agentRuntime,
            source: 'lambda:userMemories.reEmbed',
            userId: ctx.userId,
          });

          if (response.length !== texts.length) {
            throw new Error('Embedding response length mismatch');
          }

          return response.map((embedding) => {
            if (!embedding) throw new Error('Embedding response length mismatch');

            return embedding;
          });
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
            notTrashed(userMemories.isDeleted),
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
});

import { z } from 'zod';

import { cloudWorkspaceAuth } from '@/business/server/trpc-middlewares/workspaceAuth';
import { publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';

import { messagesByCursorInputSchema, readMessagesByCursor } from './_helpers/messagesByCursor';

/**
 * Upper bound on topics per batch read. The batch exists so a sidebar can warm
 * its visible rows with ONE round trip; the cap keeps that request from turning
 * into a fan-out over an arbitrarily long list.
 */
const MAX_BATCH_TOPIC_COUNT = 8;

const batchItemSchema = messagesByCursorInputSchema
  .pick({ agentId: true, groupId: true })
  .extend({ topicId: z.string().min(1) });

/**
 * Procedures shared by `messageRouter`, split out to keep the router file within
 * its size budget. Registered flat (`message.getMessagesByCursorBatch`).
 */
export const messageBatchProcedures = {
  /**
   * Batch form of `getMessagesByCursor`, for prefetching a sidebar's visible
   * topic rows.
   *
   * Every item goes through the same `readMessagesByCursor` path as the single
   * read, so guards, context resolution and projection behave identically; only
   * the round trip is shared. One item failing fails the call, which the client
   * treats as "prefetch failed" and re-reads per topic.
   *
   * Backward-only and newest-page-only on purpose: this is a warm-up read, and
   * a caller that needs another cursor can ask for that topic directly.
   */
  getMessagesByCursorBatch: publicProcedure
    .use(cloudWorkspaceAuth)
    .use(serverDatabase)
    .input(
      messagesByCursorInputSchema
        .pick({
          countBudget: true,
          includeFileWorks: true,
          projectToolPayloads: true,
          roundLimit: true,
          skipWorks: true,
        })
        .extend({
          items: z.array(batchItemSchema).min(1).max(MAX_BATCH_TOPIC_COUNT),
        }),
    )
    .query(async ({ ctx, input }) => {
      const { items, ...shared } = input;

      // Bounded by the input cap above; a handful of small per-topic reads run
      // in parallel so the client still sees one round trip.
      return Promise.all(
        items.map(async (item) => {
          const page = await readMessagesByCursor(
            { serverDB: ctx.serverDB, userId: ctx.userId, workspaceId: ctx.workspaceId },
            {
              ...shared,
              agentId: item.agentId,
              direction: 'backward',
              groupId: item.groupId,
              topicId: item.topicId,
            },
          );

          return { ...page, topicId: item.topicId };
        }),
      );
    }),
};

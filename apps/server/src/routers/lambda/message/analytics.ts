import { z } from 'zod';

import { messageProcedure } from './procedures';

/**
 * Shared input for the ownership-scoped message analytics queries
 * (count / countByTopic / topicStats). Every field is an optional filter
 * applied on top of the `userId × workspace` ownership predicate.
 */
const messageAnalyticsSchema = z.object({
  agentId: z.string().optional(),
  endDate: z.string().optional(),
  range: z.tuple([z.string(), z.string()]).optional(),
  role: z.string().optional(),
  startDate: z.string().optional(),
  topicId: z.string().optional(),
});

export const analyticsProcedures = {
  listAll: messageProcedure
    .input(
      messageAnalyticsSchema
        .extend({
          current: z.number().optional(),
          pageSize: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.queryAll(input);
    }),

  count: messageProcedure
    .input(messageAnalyticsSchema.extend({ approximate: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { approximate, ...filters } = input ?? {};

      // Dashboard totals tolerate an estimate; an exact COUNT over a heavy
      // account's messages takes tens of seconds.
      if (approximate) return ctx.messageModel.countApproximate(filters);

      return ctx.messageModel.count(filters);
    }),

  /**
   * Count messages grouped by topic (server-side GROUP BY), sorted by count
   * desc. Optionally scoped by agent / role / date range.
   */
  countByTopic: messageProcedure
    .input(messageAnalyticsSchema.optional())
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.countGroupByTopic(input);
    }),

  countWords: messageProcedure
    .input(
      z
        .object({
          endDate: z.string().optional(),
          range: z.tuple([z.string(), z.string()]).optional(),
          startDate: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.countWords(input);
    }),

  getHeatmaps: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.getHeatmaps();
  }),
  getTokenHeatmaps: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.getTokenHeatmaps();
  }),
  rankModels: messageProcedure.query(async ({ ctx }) => {
    return ctx.messageModel.rankModels();
  }),
  /**
   * Distribution of message counts per topic (topics / mean / median / p90 /
   * p99 / one-shot ratio + histogram). Aggregated server-side; optionally
   * scoped by agent / role / date range.
   */
  topicStats: messageProcedure
    .input(messageAnalyticsSchema.optional())
    .query(async ({ ctx, input }) => {
      return ctx.messageModel.topicMessageStats(input);
    }),
};

import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type BatchTaskResult } from '@/types/service';

const topicProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, ctx.workspaceId ?? undefined),
    },
  });
});

const topicCreateProcedure = topicProcedure.use(withScopedPermission('topic:create'));
const topicDeleteProcedure = topicProcedure.use(withScopedPermission('topic:delete'));
const topicUpdateProcedure = topicProcedure.use(withScopedPermission('topic:update'));

export const topicRouter = router({
  batchCreateTopics: topicCreateProcedure
    .input(
      z.array(
        z.object({
          favorite: z.boolean().optional(),
          id: z.string().optional(),
          messages: z.array(z.string()).optional(),
          sessionId: z.string().optional(),
          title: z.string(),
        }),
      ),
    )
    .mutation(async ({ input, ctx }): Promise<BatchTaskResult> => {
      const data = await ctx.topicModel.batchCreate(
        input.map((item) => ({
          ...item,
        })) as any,
      );

      return { added: data.length, ids: [], skips: [], success: true };
    }),

  batchDelete: topicDeleteProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDelete(input.ids);
    }),

  batchDeleteBySessionId: topicDeleteProcedure
    .input(z.object({ id: z.string().nullish() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.batchDeleteBySessionId(input.id);
    }),

  cloneTopic: topicCreateProcedure
    .input(z.object({ id: z.string(), newTitle: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.topicModel.duplicate(input.id, input.newTitle);

      return data.topic.id;
    }),

  countTopics: topicProcedure
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
      return ctx.topicModel.count(input);
    }),

  createTopic: topicCreateProcedure
    .input(
      z.object({
        favorite: z.boolean().optional(),
        groupId: z.string().nullish(),
        messages: z.array(z.string()).optional(),
        sessionId: z.string().nullish(),
        title: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.topicModel.create(input);

      return data.id;
    }),

  getTopics: topicProcedure
    .input(
      z.object({
        containerId: z.string().nullish(),
        current: z.number().optional(),
        pageSize: z.number().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.topicModel.query(input);
    }),

  hasTopics: topicProcedure.query(async ({ ctx }) => {
    return (await ctx.topicModel.count()) === 0;
  }),

  rankTopics: topicProcedure.input(z.number().optional()).query(async ({ ctx, input }) => {
    return ctx.topicModel.rank(input);
  }),

  removeAllTopics: topicDeleteProcedure.mutation(async ({ ctx }) => {
    return ctx.topicModel.deleteAll();
  }),

  removeTopic: topicDeleteProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.delete(input.id);
    }),

  searchTopics: topicProcedure
    .input(
      z.object({
        groupId: z.string().nullish(),
        keywords: z.string(),
        sessionId: z.string().nullish(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.topicModel.queryByKeyword(input.keywords, input.sessionId);
    }),

  updateTopic: topicUpdateProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          favorite: z.boolean().optional(),
          historySummary: z.string().optional(),
          messages: z.array(z.string()).optional(),
          metadata: z
            .object({
              model: z.string().optional(),
              provider: z.string().optional(),
            })
            .optional(),
          sessionId: z.string().optional(),
          title: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.topicModel.update(input.id, input.value);
    }),
});

export type TopicRouter = typeof topicRouter;

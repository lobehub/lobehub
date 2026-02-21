import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { insertThreadSchema } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type ThreadItem } from '@/types/topic/thread';
import { createThreadSchema } from '@/types/topic/thread';

const threadProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const threadRouter = router({
  createThread: threadProcedure.input(createThreadSchema).mutation(async ({ input, ctx }) => {
    const thread = await ctx.threadModel.create({
      metadata: input.metadata,
      parentThreadId: input.parentThreadId,
      sourceMessageId: input.sourceMessageId,
      title: input.title,
      topicId: input.topicId,
      type: input.type,
    });

    return thread?.id;
  }),
  createThreadWithMessage: threadProcedure
    .input(
      createThreadSchema.extend({
        message: z.any(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const thread = await ctx.threadModel.create({
        metadata: input.metadata,
        parentThreadId: input.parentThreadId,
        sourceMessageId: input.sourceMessageId,
        title: input.message.content.slice(0, 20),
        topicId: input.topicId,
        type: input.type,
      });

      const message = await ctx.messageModel.create({ ...input.message, threadId: thread?.id });

      return { messageId: message?.id, threadId: thread?.id };
    }),
  getThread: threadProcedure.query(async ({ ctx }): Promise<ThreadItem[]> => {
    return ctx.threadModel.query() as any;
  }),

  getThreads: threadProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.threadModel.queryByTopicId(input.topicId);
    }),

  removeAllThreads: threadProcedure.mutation(async ({ ctx }) => {
    return ctx.threadModel.deleteAll();
  }),

  removeThread: threadProcedure
    .input(z.object({ id: z.string(), removeChildren: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.threadModel.delete(input.id);
    }),

  updateThread: threadProcedure
    .input(
      z.object({
        id: z.string(),
        value: insertThreadSchema.partial(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.threadModel.update(input.id, input.value);
    }),
});

export type ThreadRouter = typeof threadRouter;

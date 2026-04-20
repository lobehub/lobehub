import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { insertThreadSchema } from '@/database/schemas';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type ThreadItem } from '@/types/topic/thread';
import { createThreadSchema } from '@/types/topic/thread';

/**
 * `ThreadModel.create` uses `onConflictDoNothing()` and returns undefined when
 * the inserted id collides with an existing row. With server-generated 16-char
 * nanoids this branch was effectively unreachable, but caller-provided ids
 * (used by the CC subagent executor to allocate `threadId` synchronously
 * before the create call resolves) can collide on retry or duplicate
 * submission. Translating undefined into a CONFLICT error is required to
 * avoid the downstream `messageModel.create({ threadId: undefined })` orphan
 * write the original code allowed.
 */
const ensureThreadCreated = <T extends { id: string } | undefined>(
  thread: T,
  providedId: string | undefined,
): NonNullable<T> => {
  if (thread) return thread as NonNullable<T>;
  throw new TRPCError({
    code: 'CONFLICT',
    message: providedId
      ? `Thread id collision: ${providedId}. Regenerate the id and retry.`
      : 'Thread create returned no row',
  });
};

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
    const thread = ensureThreadCreated(
      await ctx.threadModel.create({
        id: input.id,
        metadata: input.metadata,
        parentThreadId: input.parentThreadId,
        sourceMessageId: input.sourceMessageId,
        title: input.title,
        topicId: input.topicId,
        type: input.type,
      }),
      input.id,
    );

    return thread.id;
  }),
  createThreadWithMessage: threadProcedure
    .input(
      createThreadSchema.extend({
        message: z.any(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const thread = ensureThreadCreated(
        await ctx.threadModel.create({
          id: input.id,
          metadata: input.metadata,
          parentThreadId: input.parentThreadId,
          sourceMessageId: input.sourceMessageId,
          title: input.message.content.slice(0, 20),
          topicId: input.topicId,
          type: input.type,
        }),
        input.id,
      );

      const message = await ctx.messageModel.create({ ...input.message, threadId: thread.id });

      return { messageId: message?.id, threadId: thread.id };
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

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { MessageModel } from '@/database/models/message';
import { ThreadModel } from '@/database/models/thread';
import { updateThreadSchema } from '@/database/schemas';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { type ThreadItem } from '@/types/topic/thread';
import { createThreadSchema } from '@/types/topic/thread';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { assertWorkspaceRowManageable } from './_helpers/assertWorkspaceRowManageable';

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

const threadProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      threadModel: new ThreadModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});

export const threadRouter = router({
  createThread: threadProcedure
    .use(withScopedPermission('topic:create'))
    .input(createThreadSchema)
    .mutation(async ({ input, ctx }) => {
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
    .use(withScopedPermission('topic:create'))
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
          title: markdownToTxt(input.message.content).slice(0, 80),
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

  removeAllThreads: threadProcedure
    .use(withScopedPermission('topic:delete'))
    .mutation(async ({ ctx }) => {
      return ctx.threadModel.deleteAll();
    }),

  removeThread: threadProcedure
    .use(withScopedPermission('topic:delete'))
    .input(z.object({ id: z.string(), removeChildren: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const thread = await ctx.threadModel.findById(input.id);
      if (thread) assertWorkspaceRowManageable(ctx, thread.userId, 'thread');

      return ctx.threadModel.delete(input.id);
    }),

  updateThread: threadProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        id: z.string(),
        value: updateThreadSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const thread = await ctx.threadModel.findById(input.id);
      if (thread) assertWorkspaceRowManageable(ctx, thread.userId, 'thread');

      return ctx.threadModel.update(input.id, input.value);
    }),
});

export type ThreadRouter = typeof threadRouter;

import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent-notify-router');

const agentNotifyProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

const NotifySchema = z.object({
  /** Message content from the external agent */
  content: z.string(),
  /** Optional external session ID for tracing */
  sessionId: z.string().optional(),
  /** Topic ID to send the message to */
  topicId: z.string(),
});

export const agentNotifyRouter = router({
  /**
   * Receive a callback message from an external agent (e.g. Claude Code),
   * write it into a topic, and trigger the agent loop to process it.
   */
  notify: agentNotifyProcedure.input(NotifySchema).mutation(async ({ input, ctx }) => {
    const { topicId, content, sessionId } = input;

    log('notify: topicId=%s, sessionId=%s, content=%s', topicId, sessionId, content.slice(0, 80));

    // 1. Verify the topic exists and get its agentId
    const topic = await ctx.topicModel.findById(topicId);
    if (!topic) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Topic ${topicId} not found`,
      });
    }

    const agentId = topic.agentId;
    if (!agentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Topic ${topicId} has no associated agent`,
      });
    }

    // 2. Trigger the agent loop (execAgent handles message creation internally)
    try {
      const result = await ctx.aiAgentService.execAgent({
        agentId,
        appContext: { topicId },
        prompt: content,
      });

      return {
        operationId: result.operationId,
        sessionId,
        topicId,
      };
    } catch (error: any) {
      console.error('agentNotify execAgent failed: %O', error);

      if (error instanceof TRPCError) {
        throw error;
      }

      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to trigger agent: ${error.message}`,
      });
    }
  }),
});

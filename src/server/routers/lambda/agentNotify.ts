import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
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
      messageModel: new MessageModel(ctx.serverDB, ctx.userId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId),
    },
  });
});

const NotifySchema = z.object({
  /** Agent ID to trigger (overrides the topic's default agent) */
  agentId: z.string().optional(),
  /** Message content from the external agent */
  content: z.string(),
  /**
   * When role is 'assistant': whether to trigger a new agent turn after writing
   * the assistant message. Defaults to false.
   */
  continue: z.boolean().optional(),
  /**
   * When role is 'assistant': update an existing message instead of creating a
   * new one. The caller is responsible for passing the messageId returned by the
   * first notify call. Subsequent calls with this id will overwrite the content
   * in-place, keeping a single bubble in the UI.
   */
  messageId: z.string().optional(),
  /**
   * Role of the message to write:
   * - 'user' (default): write as user message and trigger the agent to reply
   * - 'assistant': write directly as assistant message without an extra LLM call
   */
  role: z.enum(['assistant', 'user']).optional(),
  /** Thread ID for threaded conversations */
  threadId: z.string().optional(),
  /** Topic ID to send the message to */
  topicId: z.string(),
});

export const agentNotifyRouter = router({
  /**
   * Receive a callback message from an external agent (e.g. Claude Code),
   * write it into a topic, and optionally trigger the agent loop.
   *
   * role='user' (default): content becomes a user message → agent replies
   * role='assistant': content is written directly as an assistant message
   *   continue=true: also trigger a new agent turn after writing
   */
  notify: agentNotifyProcedure.input(NotifySchema).mutation(async ({ input, ctx }) => {
    const {
      topicId,
      content,
      agentId: inputAgentId,
      threadId,
      role = 'user',
      continue: shouldContinue = false,
      messageId,
    } = input;

    log(
      'notify: topicId=%s, agentId=%s, role=%s, continue=%s, messageId=%s, content=%s',
      topicId,
      inputAgentId,
      role,
      shouldContinue,
      messageId,
      content.slice(0, 80),
    );

    // 1. Verify the topic exists and get its agentId
    const topic = await ctx.topicModel.findById(topicId);
    if (!topic) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Topic ${topicId} not found`,
      });
    }

    const agentId = inputAgentId ?? topic.agentId;
    if (!agentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Topic ${topicId} has no associated agent and no agentId was provided`,
      });
    }

    // 2a. Assistant mode: write message directly without triggering LLM
    if (role === 'assistant') {
      try {
        // Update existing message if messageId provided (single-bubble progress updates)
        if (messageId) {
          await ctx.messageModel.update(messageId, { content });
          if (shouldContinue) {
            const result = await ctx.aiAgentService.execAgent({
              agentId,
              appContext: { threadId, topicId },
              parentMessageId: messageId,
              prompt: '',
              resume: true,
              trigger: RequestTrigger.Notify,
            });
            return { messageId, operationId: result.operationId, topicId };
          }
          return { messageId, operationId: undefined, topicId };
        }

        const msg = await ctx.messageModel.create({
          agentId,
          content,
          role: 'assistant',
          threadId: threadId ?? undefined,
          topicId,
        });

        // Optionally trigger a follow-up agent turn.
        // Use resume=true + parentMessageId so execAgent skips creating an
        // empty user message (effectiveResume=true bypasses that branch).
        if (shouldContinue) {
          const result = await ctx.aiAgentService.execAgent({
            agentId,
            appContext: { threadId, topicId },
            parentMessageId: msg.id,
            prompt: '',
            resume: true,
            trigger: RequestTrigger.Notify,
          });

          return {
            messageId: msg.id,
            operationId: result.operationId,
            topicId,
          };
        }

        return { messageId: msg.id, operationId: undefined, topicId };
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to write assistant message: ${error.message}`,
        });
      }
    }

    // 2b. User mode (default): trigger the agent loop
    try {
      const result = await ctx.aiAgentService.execAgent({
        agentId,
        appContext: { threadId, topicId },
        prompt: content,
        trigger: RequestTrigger.Notify,
      });

      return {
        operationId: result.operationId,
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

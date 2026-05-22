import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { AiAgentService } from '@/server/services/aiAgent';

// Module-level singleton so we don't create a new Redis connection per request.
let _streamManager: ReturnType<typeof createStreamEventManager> | undefined;
const getStreamManager = () => {
  if (!_streamManager) _streamManager = createStreamEventManager();
  return _streamManager;
};

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
   * Signal that the remote hetero agent (openclaw / hermes) has finished its
   * task. When true, the server publishes `agent_runtime_end` to the stream event
   * manager so the frontend's gateway WS subscription closes cleanly.
   * Can be combined with content (final message + done) or sent alone (just done).
   */
  done: z.boolean().optional(),
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
      done = false,
      messageId,
    } = input;

    log(
      'notify: topicId=%s, agentId=%s, role=%s, continue=%s, done=%s, messageId=%s, content=%s',
      topicId,
      inputAgentId,
      role,
      shouldContinue,
      done,
      messageId,
      content.slice(0, 80),
    );

    // 1. Verify the topic exists and get its agentId + running operationId
    const topic = await ctx.topicModel.findById(topicId);
    if (!topic) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Topic ${topicId} not found`,
      });
    }

    // Extract the operationId seeded by execAgent for remote hetero agents.
    // Used to publish notify_update / agent_runtime_end events to the gateway WS.
    const remoteOperationId = (topic.metadata as any)?.runningOperation?.operationId as
      | string
      | undefined;

    const agentId = inputAgentId ?? topic.agentId;
    if (!agentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Topic ${topicId} has no associated agent and no agentId was provided`,
      });
    }

    /**
     * Publish a stream event for remote hetero agents (openclaw / hermes).
     * Fire-and-forget — stream publish failures must not break the notify response.
     */
    const publishRemoteHeteroEvent = async (writtenMessageId?: string) => {
      if (!remoteOperationId) return;
      try {
        const stream = getStreamManager();
        if (done) {
          // Signal task completion — frontend gateway WS subscription closes.
          await stream.publishAgentRuntimeEnd(
            remoteOperationId,
            0,
            { reason: 'success' },
            'success',
            'Remote hetero agent task completed',
          );
        } else {
          // Lightweight invalidation — frontend calls fetchAndReplaceMessages.
          await stream.publishStreamEvent(remoteOperationId, {
            data: { messageId: writtenMessageId },
            stepIndex: 0,
            type: 'notify_update',
          });
        }
      } catch (err) {
        log(
          'notify: failed to publish stream event for operationId=%s: %O',
          remoteOperationId,
          err,
        );
      }
    };

    // 2a. Assistant mode: write message directly without triggering LLM
    if (role === 'assistant') {
      try {
        // Resolve the target message ID:
        // 1. Caller-supplied messageId (subsequent notify calls with --message-id)
        // 2. Placeholder assistantMessageId seeded by execAgent (first notify call for remote hetero)
        // Using the placeholder avoids creating a second empty bubble in the UI.
        const placeholderMessageId = (topic.metadata as any)?.runningOperation
          ?.assistantMessageId as string | undefined;
        const resolvedMessageId = messageId ?? placeholderMessageId;

        // Update existing message if we have a resolved target
        if (resolvedMessageId) {
          // Security: verify the message belongs to this topic before writing.
          // MessageModel.update scopes only by userId; without this check, a remote
          // runtime could overwrite messages from other conversations.
          const existingMsg = await ctx.messageModel.findById(resolvedMessageId);
          if (!existingMsg || existingMsg.topicId !== topicId) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Message does not belong to this topic',
            });
          }

          // done=true with empty content + existing placeholder → just signal completion, no update.
          if (done && !content) {
            void publishRemoteHeteroEvent();
            return { messageId: resolvedMessageId, operationId: undefined, topicId };
          }
          await ctx.messageModel.update(resolvedMessageId, { content });
          void publishRemoteHeteroEvent(resolvedMessageId);
          if (shouldContinue) {
            const result = await ctx.aiAgentService.execAgent({
              agentId,
              appContext: { threadId, topicId },
              parentMessageId: resolvedMessageId,
              prompt: '',
              resume: true,
              trigger: RequestTrigger.Notify,
            });
            return { messageId: resolvedMessageId, operationId: result.operationId, topicId };
          }
          return { messageId: resolvedMessageId, operationId: undefined, topicId };
        }

        // done=true with no messageId and empty content → just signal completion, no DB write.
        if (done && !content) {
          void publishRemoteHeteroEvent();
          return { messageId: undefined, operationId: undefined, topicId };
        }

        const msg = await ctx.messageModel.create({
          agentId,
          content,
          role: 'assistant',
          threadId: threadId ?? undefined,
          topicId,
        });

        void publishRemoteHeteroEvent(msg.id);

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

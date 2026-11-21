import { LOADING_FLAT } from '@lobechat/const';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';

import { assertCanUseAgentRunConversation } from './guards';
import { aiAgentWriteProcedure } from './procedures';
import { createUiMessageFileUrlResolver } from './utils';

const log = debug('lobe-server:ai-agent-router');

/**
 * Schema for createClientTaskThread - create Thread for client-side task execution
 * This is used when runInClient=true on desktop client (single agent mode)
 */
const CreateClientTaskThreadSchema = z.object({
  /** The Agent ID to execute the task */
  agentId: z.string(),
  /** Optional assistant placeholder for transports that stream into an existing row. */
  assistantMessage: z.object({ provider: z.string() }).optional(),
  /** The Group ID (optional, only for Group mode) */
  groupId: z.string().optional(),
  /** Initial user message content (task instruction) */
  instruction: z.string(),
  /** The parent message ID (task message) */
  parentMessageId: z.string(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});

/**
 * Schema for createClientGroupAgentTaskThread - create Thread for client-side task execution in Group mode
 * This is specifically for Group Chat where messages may have different agentIds
 */
const CreateClientGroupAgentTaskThreadSchema = z.object({
  /** The Group ID (required for Group mode) */
  groupId: z.string(),
  /** Initial user message content (task instruction) */
  instruction: z.string(),
  /** The parent message ID (task message) */
  parentMessageId: z.string(),
  /** The Sub-Agent ID that will execute the task (worker agent in group) */
  subAgentId: z.string(),
  /** Task title (shown in UI, used as thread title) */
  title: z.string().optional(),
  /** The Topic ID */
  topicId: z.string(),
});

/**
 * Schema for updateClientTaskThreadStatus - update Thread status after client-side execution
 */
const UpdateClientTaskThreadStatusSchema = z.object({
  /** Completion reason */
  completionReason: z.enum(['done', 'error', 'interrupted']),
  /** Error message if failed */
  error: z.string().optional(),
  /** Thread metadata to update */
  metadata: z
    .object({
      totalCost: z.number().optional(),
      totalMessages: z.number().optional(),
      totalSteps: z.number().optional(),
      totalTokens: z.number().optional(),
      totalToolCalls: z.number().optional(),
    })
    .optional(),
  /** Result content (last assistant message) */
  resultContent: z.string().optional(),
  /** The Thread ID */
  threadId: z.string(),
});

export const clientTaskThreadRouter = router({
  /**
   * Create Thread for client-side task execution in Group mode
   *
   * This endpoint is specifically designed for Group Chat scenarios where:
   * - Messages in the thread may have different agentIds (supervisor, workers)
   * - The subAgentId is the worker agent that executes the task
   * - Thread messages query should not filter by agentId to include all parent messages
   */
  createClientGroupAgentTaskThread: aiAgentWriteProcedure
    .input(CreateClientGroupAgentTaskThreadSchema)
    .mutation(async ({ input, ctx }) => {
      const { groupId, instruction, parentMessageId, subAgentId, title, topicId } = input;

      log('createClientGroupAgentTaskThread: subAgentId=%s, groupId=%s', subAgentId, groupId);

      try {
        await assertCanUseWorkspaceAgent({
          agentId: subAgentId,
          db: ctx.serverDB,
          groupId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: [parentMessageId],
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        // 1. Create Thread for isolated task execution
        // Use subAgentId as the thread's agentId (the executing agent)
        const startedAt = new Date().toISOString();
        const thread = await ctx.threadModel.create({
          agentId: subAgentId,
          groupId,
          metadata: { clientMode: true, startedAt },
          sourceMessageId: parentMessageId,
          status: ThreadStatus.Processing,
          title,
          topicId,
          type: ThreadType.Isolation,
        });

        if (!thread) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create thread for task execution',
          });
        }

        log('createClientGroupAgentTaskThread: created thread %s', thread.id);

        // 2. Create initial user message (persisted to database)
        // Use subAgentId as the message's agentId
        const userMessage = await ctx.messageModel.create({
          agentId: subAgentId,
          content: instruction,
          groupId,
          parentId: parentMessageId,
          role: 'user',
          threadId: thread.id,
          topicId,
        });

        log('createClientGroupAgentTaskThread: created user message %s', userMessage.id);

        // 3. Query thread messages and main chat messages in parallel
        const messageQueryOptions = {
          postProcessUrl: createUiMessageFileUrlResolver(),
        };
        const [threadMessages, messages] = await Promise.all([
          // Thread messages (messages within this thread)
          // DON'T pass agentId - thread query fetches parent messages via sourceMessageId
          // which may have different agentIds (supervisor vs worker in group chat)
          ctx.messageModel.query({ threadId: thread.id, topicId }, messageQueryOptions),
          // Main chat messages (messages without threadId)
          // Only filter by groupId + topicId (not agentId) to include all agents' messages
          ctx.messageModel.query({ groupId, topicId }, messageQueryOptions),
        ]);

        log(
          'createClientGroupAgentTaskThread: queried %d thread messages, %d main messages',
          threadMessages.length,
          messages.length,
        );

        // 4. Return Thread, userMessageId, threadMessages and messages
        return {
          messages,
          startedAt,
          success: true,
          threadId: thread.id,
          threadMessages,
          userMessageId: userMessage.id,
        };
      } catch (error: any) {
        log('createClientGroupAgentTaskThread failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create client group agent task thread: ${error.message}`,
        });
      }
    }),
  /**
   * Create Thread for client-side task execution
   *
   * This endpoint is called by desktop client when runInClient=true.
   * It creates the Thread but does NOT execute the task - execution happens on client side.
   */
  createClientTaskThread: aiAgentWriteProcedure
    .input(CreateClientTaskThreadSchema)
    .mutation(async ({ input, ctx }) => {
      const { agentId, assistantMessage, groupId, instruction, parentMessageId, title, topicId } =
        input;

      log('createClientTaskThread: agentId=%s, groupId=%s', agentId, groupId);

      try {
        await assertCanUseWorkspaceAgent({
          agentId,
          db: ctx.serverDB,
          groupId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: [parentMessageId],
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        // 1. Create Thread for isolated task execution
        const startedAt = new Date().toISOString();
        const thread = await ctx.threadModel.create({
          agentId,
          groupId,
          metadata: { clientMode: true, startedAt },
          sourceMessageId: parentMessageId,
          status: ThreadStatus.Processing,
          title,
          topicId,
          type: ThreadType.Isolation,
        });

        if (!thread) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create thread for task execution',
          });
        }

        log('createClientTaskThread: created thread %s', thread.id);

        // 2. Create initial user message (persisted to database)
        const userMessage = await ctx.messageModel.create({
          agentId,
          content: instruction,
          groupId,
          parentId: parentMessageId,
          role: 'user',
          threadId: thread.id,
          topicId,
        });

        log('createClientTaskThread: created user message %s', userMessage.id);

        const assistantMessageRecord = assistantMessage
          ? await ctx.messageModel.create({
              agentId,
              content: LOADING_FLAT,
              groupId,
              parentId: userMessage.id,
              provider: assistantMessage.provider,
              role: 'assistant',
              threadId: thread.id,
              topicId,
            })
          : undefined;

        // 3. Query thread messages and main chat messages in parallel
        const messageQueryOptions = {
          postProcessUrl: createUiMessageFileUrlResolver(),
        };
        const [threadMessages, messages] = await Promise.all([
          // Thread messages (messages within this thread)
          ctx.messageModel.query({ agentId, threadId: thread.id, topicId }, messageQueryOptions),
          // Main chat messages (messages without threadId, includes updated taskDetail)
          // Pass both agentId and groupId - query() prioritizes groupId when present
          ctx.messageModel.query({ agentId, groupId, topicId }, messageQueryOptions),
        ]);

        log(
          'createClientTaskThread: queried %d thread messages, %d main messages',
          threadMessages.length,
          messages.length,
        );

        // 4. Return Thread, userMessageId, threadMessages and messages
        return {
          assistantMessageId: assistantMessageRecord?.id,
          messages,
          startedAt,
          success: true,
          threadId: thread.id,
          threadMessages,
          userMessageId: userMessage.id,
        };
      } catch (error: any) {
        log('createClientTaskThread failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create client task thread: ${error.message}`,
        });
      }
    }),
  /**
   * Update Thread status after client-side task execution completes
   *
   * This endpoint is called by desktop client after task execution finishes.
   * It updates the Thread status and metadata similar to server-side completion.
   */
  updateClientTaskThreadStatus: aiAgentWriteProcedure
    .input(UpdateClientTaskThreadStatusSchema)
    .mutation(async ({ input, ctx }) => {
      const { threadId, completionReason, error, resultContent, metadata } = input;

      log('updateClientTaskThreadStatus: threadId=%s, reason=%s', threadId, completionReason);

      try {
        // Find thread
        const thread = await ctx.threadModel.findById(threadId);
        if (!thread) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Thread not found',
          });
        }

        const completedAt = new Date().toISOString();
        const startedAt = thread.metadata?.startedAt;
        const duration = startedAt ? Date.now() - new Date(startedAt).getTime() : undefined;

        // Determine thread status based on completion reason
        let status: ThreadStatus;
        switch (completionReason) {
          case 'done': {
            status = ThreadStatus.Completed;
            break;
          }
          case 'error': {
            status = ThreadStatus.Failed;
            break;
          }
          case 'interrupted': {
            status = ThreadStatus.Cancel;
            break;
          }
          default: {
            status = ThreadStatus.Completed;
          }
        }

        // Update Thread metadata and status
        await ctx.threadModel.update(threadId, {
          metadata: {
            ...thread.metadata,
            completedAt,
            duration,
            error: error || undefined,
            totalCost: metadata?.totalCost,
            totalMessages: metadata?.totalMessages,
            totalSteps: metadata?.totalSteps,
            totalTokens: metadata?.totalTokens,
            totalToolCalls: metadata?.totalToolCalls,
          },
          status,
        });

        // Update task message (sourceMessageId) with result content if provided
        if (resultContent && thread.sourceMessageId) {
          await ctx.messageModel.update(thread.sourceMessageId, {
            content: resultContent,
          });
          log(
            'updateClientTaskThreadStatus: updated task message %s with result',
            thread.sourceMessageId,
          );
        }

        log('updateClientTaskThreadStatus: thread %s completed with status %s', threadId, status);

        return {
          status,
          success: true,
          threadId,
        };
      } catch (error: any) {
        log('updateClientTaskThreadStatus failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to update client task thread status: ${error.message}`,
        });
      }
    }),
});

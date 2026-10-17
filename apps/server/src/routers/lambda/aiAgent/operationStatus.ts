import { parse } from '@lobechat/conversation-flow';
import type { TaskCurrentActivity, TaskStatusResult } from '@lobechat/types';
import { ThreadStatus } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { agentOperations } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notShareVisitorTopicRef } from '@/database/utils/shareVisitor';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';

import { aiAgentProcedure } from './procedures';
import { createUiMessageFileUrlResolver } from './utils';

const log = debug('lobe-server:ai-agent-router');

/**
 * Ownership guard for operation-keyed READ endpoints (`getOperationStatus`,
 * `getPendingInterventions`). The runtime coordinator keys operations purely
 * by id and returns the raw operation metadata — including the executing
 * user's full `agentConfig` and `modelRuntimeConfig` — so the id itself must
 * not act as a bearer token.
 *
 * Historically that was inert: an operation id was only ever known to the
 * user who started it. Agent Share breaks the assumption on purpose — a share
 * run executes under the CREATOR's identity while the VISITOR receives the
 * `operationId` (to attach to the Gateway stream, which redacts creator
 * details). Without this guard the visitor could replay that id here and read
 * the unredacted creator config the stream path deliberately hides.
 *
 * Visible to: the operation's owner, or (workspace runs) a member with `use`
 * access to the operation's agent in the SAME workspace as the caller.
 * Everything else — share visitors, AND the creator looking at a visitor's
 * run — resolves as NOT_FOUND so the endpoint does not confirm which ids
 * exist.
 */
const assertOperationVisibleToCaller = async (params: {
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
  workspaceId?: string | null;
}) => {
  const { db, operationId, userId, workspaceId } = params;

  // Share-visitor runs are ALSO excluded (`notShareVisitorTopicRef`): they
  // execute under the creator's userId, so the owner shortcut below would
  // otherwise hand the creator the visitor's run metadata, history and
  // stream events — the same exclusion `findOwnOperationById` applies to
  // the trace reads.
  const [row] = await db
    .select({
      agentId: agentOperations.agentId,
      userId: agentOperations.userId,
      workspaceId: agentOperations.workspaceId,
    })
    .from(agentOperations)
    .where(
      and(eq(agentOperations.id, operationId), notShareVisitorTopicRef(agentOperations.topicId)),
    )
    .limit(1);

  const notFound = () => new TRPCError({ code: 'NOT_FOUND', message: 'Operation not found' });

  if (!row) throw notFound();
  if (row.userId === userId) return;

  if (!row.workspaceId || !workspaceId || row.workspaceId !== workspaceId || !row.agentId) {
    throw notFound();
  }

  await assertCanUseWorkspaceAgent({ agentId: row.agentId, db, userId, workspaceId });
};

const extractTaskErrorMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  const taskError = error as Record<string, any>;
  const candidates = [
    taskError.body?.error?.message,
    taskError.body?.message,
    taskError.error?.error?.message,
    taskError.error?.message,
    taskError.message,
    taskError.type,
    taskError.errorType,
    taskError.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '[object Object]' && candidate !== 'error') {
      return candidate;
    }
  }

  return undefined;
};

const formatTaskError = (error: unknown): Record<string, unknown> | undefined => {
  if (!error) return undefined;

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  if (typeof error !== 'object') {
    return { message: String(error) };
  }

  const taskError = error as Record<string, unknown>;
  const message = extractTaskErrorMessage(error);

  return message ? { ...taskError, message } : taskError;
};

const GetOperationStatusSchema = z.object({
  historyLimit: z.number().optional().default(10),
  includeHistory: z.boolean().optional().default(false),
  operationId: z.string(),
});

const GetPendingInterventionsSchema = z
  .object({
    operationId: z.string().optional(),
    userId: z.string().optional(),
  })
  .refine((data) => data.operationId || data.userId, {
    message: 'Either operationId or userId must be provided',
  });

export const operationStatusProcedures = {
  getOperationStatus: aiAgentProcedure
    .input(GetOperationStatusSchema)
    .query(async ({ input, ctx }) => {
      const { historyLimit, includeHistory, operationId } = input;

      if (!operationId) {
        throw new Error('operationId parameter is required');
      }

      log('Getting operation status for %s', operationId);

      await assertOperationVisibleToCaller({
        db: ctx.serverDB,
        operationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Get operation status using AgentRuntimeService
      const operationStatus = await ctx.agentRuntimeService.getOperationStatus({
        historyLimit,
        includeHistory,
        operationId,
      });

      return operationStatus;
    }),
  getPendingInterventions: aiAgentProcedure
    .input(GetPendingInterventionsSchema)
    .query(async ({ input, ctx }) => {
      const { operationId, userId } = input;

      log('Getting pending interventions for operationId: %s, userId: %s', operationId, userId);

      // Same bearer-token hazard as `getOperationStatus`: an operation id must
      // resolve to a run the caller may see, and the user-wide listing may only
      // ever enumerate the CALLER's own runs — `input.userId` is not a way to
      // read another user's pending interventions.
      if (operationId) {
        await assertOperationVisibleToCaller({
          db: ctx.serverDB,
          operationId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
      } else if (userId && userId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot list operations of another user',
        });
      }

      // Get pending interventions using AgentRuntimeService
      const result = await ctx.agentRuntimeService.getPendingInterventions({
        operationId: operationId || undefined,
        userId: operationId ? undefined : ctx.userId,
      });

      return result;
    }),
  /**
   * Get SubAgent task execution status
   *
   * This endpoint queries the status of a SubAgent task by threadId.
   * It queries from Thread table (PostgreSQL) for persistence,
   * and supplements with real-time status from Redis if available.
   *
   * Works for both Group mode and Single Agent mode tasks.
   *
   * IMPORTANT: In QStash queue mode, step lifecycle callbacks cannot fire
   * because each HTTP request creates a new AgentRuntimeService instance.
   * As a workaround, this endpoint also updates Thread metadata from Redis
   * when real-time status is available.
   */
  getSubAgentTaskStatus: aiAgentProcedure
    .input(
      z.object({
        /** Thread ID */
        threadId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { threadId } = input;

      log('getSubAgentTaskStatus: threadId=%s', threadId);

      // 1. Find thread by threadId
      const thread = await ctx.threadModel.findById(threadId);

      if (!thread) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Thread not found',
        });
      }

      // 2. Map Thread status to task status
      const threadStatusToTaskStatus: Record<string, TaskStatusResult['status']> = {
        [ThreadStatus.Active]: 'processing',
        [ThreadStatus.Cancel]: 'cancel',
        [ThreadStatus.Completed]: 'completed',
        [ThreadStatus.Failed]: 'failed',
        [ThreadStatus.InReview]: 'processing',
        [ThreadStatus.Pending]: 'processing',
        [ThreadStatus.Processing]: 'processing',
        [ThreadStatus.Todo]: 'processing',
      };

      const taskStatus = threadStatusToTaskStatus[thread.status] || 'processing';
      const metadata = thread.metadata;

      // 3. Try to get real-time status from Redis (for active tasks)
      // Note: This is optional - Redis operation may be expired or unavailable.
      // Thread table is the persistent source of truth.
      let realtimeStatus: Awaited<ReturnType<typeof ctx.agentRuntimeService.getOperationStatus>> =
        null;
      const resolvedOperationId = metadata?.operationId;
      if (resolvedOperationId && taskStatus === 'processing') {
        realtimeStatus = await ctx.agentRuntimeService.getOperationStatus({
          operationId: resolvedOperationId,
        });

        // 4. WORKAROUND for QStash mode: Update Thread metadata from Redis
        // In QStash mode, step callbacks don't fire because each HTTP request
        // creates a new AgentRuntimeService instance with empty callback map.
        // So we update Thread metadata here when polling for status.
        // Note: realtimeStatus may be null if operation expired from Redis
        if (realtimeStatus) {
          const redisState = realtimeStatus.currentState;
          const updatedMetadata: Record<string, any> = {
            ...metadata,
            operationId: resolvedOperationId,
          };

          // Update metrics from Redis state using currentState and stats
          if (redisState.usage) {
            updatedMetadata.totalTokens = redisState.usage.llm?.tokens?.total;
            updatedMetadata.totalToolCalls = redisState.usage.tools?.totalCalls;
          }
          if (redisState.cost?.total !== undefined) {
            updatedMetadata.totalCost = redisState.cost.total;
          }

          // Use stats for totalMessages (currentState doesn't include messages array)
          const { stats } = realtimeStatus;
          if (stats?.totalMessages) {
            updatedMetadata.totalMessages = stats.totalMessages;
          }

          // Store totalSteps from stepCount
          if (redisState.stepCount) {
            updatedMetadata.totalSteps = redisState.stepCount;
          }

          // Check if operation is completed
          if (realtimeStatus.isCompleted || redisState.status === 'done') {
            updatedMetadata.completedAt = new Date().toISOString();
            if (metadata?.startedAt) {
              updatedMetadata.duration = Date.now() - new Date(metadata.startedAt).getTime();
            }

            // Update thread status to completed
            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
              status: ThreadStatus.Completed,
            });

            log('getSubAgentTaskStatus: marked thread %s as completed', threadId);
          } else if (realtimeStatus.hasError || redisState.status === 'error') {
            // Normalize nested runtime errors so task metadata keeps a readable message.
            const formattedError = formatTaskError(redisState.error);

            updatedMetadata.error = formattedError;
            updatedMetadata.completedAt = new Date().toISOString();
            if (metadata?.startedAt) {
              updatedMetadata.duration = Date.now() - new Date(metadata.startedAt).getTime();
            }

            log('getSubAgentTaskStatus: error formatting for thread %s: %O', threadId, {
              originalError: redisState.error,
              formattedError,
            });

            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
              status: ThreadStatus.Failed,
            });
            log('getSubAgentTaskStatus: marked thread %s as failed', threadId);
          } else {
            // Still processing, just update metrics
            await ctx.threadModel.update(threadId, {
              metadata: updatedMetadata,
            });
            log('getSubAgentTaskStatus: updated thread %s metadata', threadId);
          }
        } else {
          // Redis status not available (expired), use Thread data only
          log(
            'getSubAgentTaskStatus: Redis operation %s expired, using Thread data only',
            resolvedOperationId,
          );
        }
      }

      // 5. Re-fetch thread to get updated metadata
      const updatedThread = await ctx.threadModel.findById(threadId);
      const updatedMetadata = updatedThread?.metadata ?? metadata;
      const updatedStatus = updatedThread?.status ?? thread.status;
      const updatedTaskStatus = threadStatusToTaskStatus[updatedStatus] || 'processing';

      if (updatedTaskStatus === 'failed') {
        log('getSubAgentTaskStatus: returning failed task status for thread %s: %O', threadId, {
          updatedMetadata,
          error: updatedMetadata?.error,
          updatedStatus,
        });
      }

      // 6. Query thread messages for result content or current activity
      const threadMessages = await ctx.messageModel.query(
        { threadId },
        {
          postProcessUrl: createUiMessageFileUrlResolver(),
        },
      );
      const sortedMessages = threadMessages.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // 6.1 Parse messages using conversation-flow for UI display
      const { flatList: parsedMessages } = parse(threadMessages, undefined, { threadId });

      // 7. Get result content when task is completed or failed
      let resultContent: string | undefined;
      if (updatedTaskStatus === 'completed' || updatedTaskStatus === 'failed') {
        const lastAssistantMessage = sortedMessages.find((m) => m.role === 'assistant');
        resultContent = lastAssistantMessage?.content;
      }

      // 8. Build currentActivity when task is processing
      let currentActivity: TaskCurrentActivity | undefined;
      if (updatedTaskStatus === 'processing' && sortedMessages.length > 0) {
        const lastMessage = sortedMessages[0];

        if (lastMessage.role === 'tool') {
          // Tool message means tool has returned result
          currentActivity = {
            apiName: lastMessage.plugin?.apiName ?? undefined,
            contentPreview: lastMessage.content?.slice(0, 100),
            identifier: lastMessage.plugin?.identifier ?? undefined,
            type: 'tool_result',
          };
        } else if (lastMessage.role === 'assistant') {
          // Check if assistant is calling tools
          const tools = lastMessage.tools as Array<{
            apiName?: string;
            identifier?: string;
          }> | null;
          if (tools && tools.length > 0) {
            const lastTool = tools.at(-1);
            currentActivity = {
              apiName: lastTool?.apiName,
              identifier: lastTool?.identifier,
              type: 'tool_calling',
            };
          } else {
            // Assistant is generating content
            currentActivity = {
              contentPreview: lastMessage.content?.slice(0, 100),
              type: 'generating',
            };
          }
        }
      }

      // 9. Build TaskDetail from Thread (uses ThreadStatus)
      const taskDetail = {
        completedAt: updatedMetadata?.completedAt,
        duration: updatedMetadata?.duration,
        error: updatedMetadata?.error,
        startedAt: updatedMetadata?.startedAt,
        status: updatedStatus,
        threadId: thread.id,
        title: thread.title,
        totalCost: updatedMetadata?.totalCost,
        totalMessages: updatedMetadata?.totalMessages,
        totalSteps: updatedMetadata?.totalSteps,
        totalTokens: updatedMetadata?.totalTokens,
        totalToolCalls: updatedMetadata?.totalToolCalls,
      };

      // 10. Build result
      const result: TaskStatusResult = {
        completedAt: updatedMetadata?.completedAt,
        cost:
          realtimeStatus?.currentState?.cost ??
          (updatedMetadata?.totalCost ? { total: updatedMetadata.totalCost } : undefined),
        currentActivity,
        error: updatedMetadata?.error ?? realtimeStatus?.currentState?.error,
        messages: parsedMessages,
        result: resultContent,
        status: updatedTaskStatus,
        stepCount: realtimeStatus?.currentState?.stepCount,
        taskDetail,
        usage:
          realtimeStatus?.currentState?.usage ??
          (updatedMetadata?.totalTokens
            ? { total_tokens: updatedMetadata.totalTokens }
            : undefined),
      };

      return result;
    }),
};

import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';
import { findOwnLiveRuns } from '@/server/services/aiAgent/steerQueue/liveRuns';

import { assertCanUseAgentRunConversation, assertCanUseOperationAgent } from './guards';
import { aiAgentWriteProcedure } from './procedures';

const log = debug('lobe-server:ai-agent-router');

/** What `interruptTask` answers; `running` / `stopped` are set when it stopped a whole topic. */
type InterruptTaskResult = {
  deviceCancellationConfirmed?: boolean;
  operationId?: string;
  /** Live runs found on the topic (topic-only stop). */
  running?: number;
  /** Of those, the ones confirmed stopped. */
  stopped?: number;
  success: boolean;
  threadId?: string;
};

/**
 * Schema for interruptTask - interrupt a running task
 */
const InterruptTaskSchema = z
  .object({
    /** Operation ID */
    operationId: z.string().optional(),
    /** Thread ID */
    threadId: z.string().optional(),
    /**
     * Topic ID — used to cancel device-backed heterogeneous agent tasks.
     * When provided and the topic's runningOperation has a deviceId, the server
     * will dispatch a cancelHeteroTask tool call to kill the device process.
     * On its own (no operation or thread), stops every live run the caller
     * owns on the topic's main line (`lh topic stop`).
     */
    topicId: z.string().optional(),
  })
  .refine((data) => data.threadId || data.operationId || data.topicId, {
    message: 'Either threadId, operationId or topicId must be provided',
  });

/**
 * Schema for setQueuedMessages - flag queued follow-ups on a running operation
 */
const SetQueuedMessagesSchema = z.object({
  operationId: z.string(),
  /** Whether the composer still holds user messages queued behind the run. */
  pending: z.boolean(),
});

const StartExecutionSchema = z.object({
  context: z.any().optional(),
  delay: z.number().optional().default(1000),
  operationId: z.string(),
  priority: z.enum(['high', 'normal', 'low']).optional().default('normal'),
});

export const runControlRouter = router({
  interruptTask: aiAgentWriteProcedure
    .input(InterruptTaskSchema)
    .mutation(async ({ input, ctx }): Promise<InterruptTaskResult> => {
      const { threadId, operationId, topicId } = input;

      log('interruptTask: threadId=%s, operationId=%s, topicId=%s', threadId, operationId, topicId);

      // A topic alone: stop the caller's own live runs on its main line.
      if (!operationId && !threadId && topicId) {
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        const runIds = await findOwnLiveRuns(
          { db: ctx.serverDB, workspaceId: ctx.workspaceId ?? undefined },
          { threadId: null, topicId, userId: ctx.userId },
        );
        let stopped = 0;
        for (const runId of runIds) {
          const result = await ctx.aiAgentService.interruptTask({ operationId: runId, topicId });
          if (result.success) stopped += 1;
        }
        // `success: false` when a run could not be confirmed stopped (a device
        // process that did not answer): it stays live so the stop can be retried.
        return {
          operationId: runIds[0],
          running: runIds.length,
          stopped,
          success: stopped === runIds.length,
        };
      }

      try {
        return await ctx.aiAgentService.interruptTask({ operationId, threadId, topicId });
      } catch (error: any) {
        if (error.message === 'Thread not found') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Thread not found' });
        }
        if (error.message === 'Operation ID not found') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Operation ID not found' });
        }
        throw error;
      }
    }),
  /**
   * Tell a running server operation whether the composer still holds user
   * messages queued behind it. The run reads the flag at its next step
   * boundary and ends the turn early, so the queued follow-up starts as the
   * next turn instead of waiting for the whole run to finish.
   */
  setQueuedMessages: aiAgentWriteProcedure
    .input(SetQueuedMessagesSchema)
    .mutation(async ({ input, ctx }) => {
      log('setQueuedMessages: operationId=%s, pending=%s', input.operationId, input.pending);

      return ctx.aiAgentService.setQueuedMessages(input);
    }),
  startExecution: aiAgentWriteProcedure
    .input(StartExecutionSchema)
    .mutation(async ({ input, ctx }) => {
      const { operationId, context, priority, delay } = input;

      log('Starting execution for operation %s', operationId);

      await assertCanUseOperationAgent({
        db: ctx.serverDB,
        operationId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      // Start execution using AgentRuntimeService
      const result = await ctx.agentRuntimeService.startExecution({
        context,
        delay,
        operationId,
        priority,
      });

      return {
        ...result,
        message: 'Agent execution started successfully',
        timestamp: new Date().toISOString(),
      };
    }),
});

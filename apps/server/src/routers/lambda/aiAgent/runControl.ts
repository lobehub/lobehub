import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import type { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import type {
  InterruptFailureReason,
  RunnerlessSettleReason,
} from '@/server/services/aiAgent/intervention/InterventionController';
import { findOwnLiveRuns } from '@/server/services/aiAgent/steerQueue/liveRuns';

import { assertCanUseAgentRunConversation, assertCanUseOperationAgent } from './guards';
import { aiAgentWriteProcedure } from './procedures';

const log = debug('lobe-server:ai-agent-router');

/** What `interruptTask` answers; `running` / `stopped` are set when it stopped a whole topic. */
type InterruptTaskResult = {
  /** Set when the run's runner was gone and the stop settled it instead. */
  completionReason?: RunnerlessSettleReason;
  deviceCancellationConfirmed?: boolean;
  /** Why the device run could not be ended, when `success` is false. */
  failureReason?: InterruptFailureReason;
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
    /**
     * End the run even when its device cannot confirm the process exited (the
     * person chose "force end" after a stop failed). The run is settled and the
     * topic released.
     */
    force: z.boolean().optional(),
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

/**
 * Clear a topic's `runningOperation` marker whose run is no longer alive (by
 * the topic model's own liveness rule), moving the topic back to `active`. A
 * live marker, or a newer run that took the topic meanwhile, is left alone:
 * `settleRunningOperation` only clears the operation it is given.
 */
const releaseDeadRunningMarker = async (
  ctx: {
    serverDB: Parameters<TopicModel['isRunningOperationAlive']>[0];
    topicModel: TopicModel;
  },
  topicId: string,
) => {
  const marker = (await ctx.topicModel.findById(topicId))?.metadata?.runningOperation;
  if (!marker || (await ctx.topicModel.isRunningOperationAlive(ctx.serverDB, marker))) return;

  log('interruptTask: releasing dead marker op=%s on topic %s', marker.operationId, topicId);
  await ctx.topicModel.settleRunningOperation(topicId, marker.operationId, 'active');
};

export const runControlRouter = router({
  interruptTask: aiAgentWriteProcedure
    .input(InterruptTaskSchema)
    .mutation(async ({ input, ctx }): Promise<InterruptTaskResult> => {
      const { force, threadId, operationId, topicId } = input;

      log(
        'interruptTask: threadId=%s, operationId=%s, topicId=%s, force=%s',
        threadId,
        operationId,
        topicId,
        force,
      );

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
        // Nothing live, yet the topic can still carry the marker of a run that
        // ended without clearing it (its terminal never landed, or it aged
        // out). Every reader already treats such a marker as dead, but the
        // topic row keeps showing `running` with nothing left to stop; release
        // it so the stop the person asked for actually ends the run.
        if (runIds.length === 0) await releaseDeadRunningMarker(ctx, topicId);

        let stopped = 0;
        let completionReason: RunnerlessSettleReason | undefined;
        let failureReason: InterruptFailureReason | undefined;
        for (const runId of runIds) {
          const result = await ctx.aiAgentService.interruptTask({
            force,
            operationId: runId,
            topicId,
          });
          if (result.success) stopped += 1;
          completionReason ??= result.completionReason;
          if (!result.success) failureReason ??= result.failureReason;
        }
        // `success: false` when a run could not be confirmed stopped (a device
        // process that did not answer): it stays live so the stop can be
        // retried, or forced.
        return {
          completionReason,
          failureReason,
          operationId: runIds[0],
          running: runIds.length,
          stopped,
          success: stopped === runIds.length,
        };
      }

      try {
        return await ctx.aiAgentService.interruptTask({ force, operationId, threadId, topicId });
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

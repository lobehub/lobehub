import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { router } from '@/libs/trpc/lambda';

import { assertCanUseOperationAgent } from './guards';
import { aiAgentWriteProcedure } from './procedures';

const log = debug('lobe-server:ai-agent-router');

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
     */
    topicId: z.string().optional(),
  })
  .refine((data) => data.threadId || data.operationId, {
    message: 'Either threadId or operationId must be provided',
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
    .mutation(async ({ input, ctx }) => {
      const { threadId, operationId, topicId } = input;

      log('interruptTask: threadId=%s, operationId=%s, topicId=%s', threadId, operationId, topicId);

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

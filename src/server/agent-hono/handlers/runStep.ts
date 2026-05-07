import debug from 'debug';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';

const log = debug('lobe-server:agent:run-step');

/**
 * Execute a single agent step. Invoked by QStash with the body
 * `{ operationId, stepIndex, context, humanInput?, approvedToolCall?, ... }`.
 *
 * Auth: `qstashAuth` on the route — QStash signature required.
 */
export async function runStep(c: Context): Promise<Response> {
  const startTime = Date.now();

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const externalRetryCount = Number(c.req.header('upstash-retried') ?? 0) || 0;

  try {
    const {
      operationId,
      stepIndex = 0,
      context,
      humanInput,
      approvedToolCall,
      rejectionReason,
      rejectAndContinue,
      toolMessageId,
    } = body;

    if (!operationId) {
      return c.json({ error: 'operationId is required' }, 400);
    }

    log(`[${operationId}] Starting step ${stepIndex}`);

    // Get userId from operation metadata stored in Redis
    const coordinator = new AgentRuntimeCoordinator();
    const metadata = await coordinator.getOperationMetadata(operationId);

    if (!metadata?.userId) {
      log(`[${operationId}] Invalid operation or no userId found`);
      return c.json({ error: 'Invalid operation or unauthorized' }, 401);
    }

    const serverDB = await getServerDB();
    const agentRuntimeService = new AgentRuntimeService(serverDB, metadata.userId);

    const result = await agentRuntimeService.executeStep({
      approvedToolCall,
      context,
      externalRetryCount,
      humanInput,
      operationId,
      rejectAndContinue,
      rejectionReason,
      stepIndex,
      toolMessageId,
    });

    // Step is currently being executed by another instance — tell QStash to retry later
    if (result.locked) {
      log(`[${operationId}] Step ${stepIndex} locked by another instance, returning 429`);
      return c.json(
        { error: 'Step is currently being executed, retry later', operationId, stepIndex },
        429,
        { 'Retry-After': '37' },
      );
    }

    const executionTime = Date.now() - startTime;

    const responseData = {
      completed: result.state.status === 'done',
      error: result.state.status === 'error' ? result.state.error : undefined,
      executionTime,
      nextStepIndex: result.nextStepScheduled ? stepIndex + 1 : undefined,
      nextStepScheduled: result.nextStepScheduled,
      operationId,
      pendingApproval: result.state.pendingToolsCalling,
      pendingPrompt: result.state.pendingHumanPrompt,
      pendingSelect: result.state.pendingHumanSelect,
      status: result.state.status,
      stepIndex,
      success: result.success,
      totalCost: result.state.cost?.total || 0,
      totalSteps: result.state.stepCount,
      waitingForHuman: result.state.status === 'waiting_for_human',
    };

    log(
      `[${operationId}] Step ${stepIndex} completed (${executionTime}ms, status: ${result.state.status})`,
    );

    return c.json(responseData);
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    console.error('Error in execution: %O', error);

    return c.json(
      {
        error: error.message,
        executionTime,
        operationId: body?.operationId,
        stepIndex: body?.stepIndex || 0,
      },
      500,
    );
  }
}

/**
 * Health check for the agent execution path.
 */
export function runStepHealth(c: Context): Response {
  return c.json({
    healthy: true,
    message: 'Agent execution service is running',
    timestamp: new Date().toISOString(),
  });
}

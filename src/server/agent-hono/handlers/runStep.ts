import debug from 'debug';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { agentOperations } from '@/database/schemas/agentOperations';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent:run-step');

const toIsoString = (value: Date | string | null | undefined): null | string => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};

const getQStashMessageId = (c: Context): string | undefined =>
  c.req.header('upstash-message-id') ??
  c.req.header('upstash-messageid') ??
  c.req.header('message-id');

async function getOperationRowDiagnostic(operationId: string) {
  try {
    const serverDB = await getServerDB();
    const [row] = await serverDB
      .select({
        completedAt: agentOperations.completedAt,
        startedAt: agentOperations.startedAt,
        status: agentOperations.status,
        stepCount: agentOperations.stepCount,
        traceS3Key: agentOperations.traceS3Key,
      })
      .from(agentOperations)
      .where(eq(agentOperations.id, operationId))
      .limit(1);

    return {
      completedAt: toIsoString(row?.completedAt),
      exists: Boolean(row),
      startedAt: toIsoString(row?.startedAt),
      status: row?.status ?? null,
      stepCount: row?.stepCount ?? null,
      traceS3KeyPresent: Boolean(row?.traceS3Key),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exists: null,
      status: null,
    };
  }
}

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
    // QStash nests resume/intervention fields under `body.payload` (see
    // QStashQueueServiceImpl.scheduleMessage), while `operationId`/`stepIndex`/
    // `context` stay at the top level. Merge so both shapes work — without this
    // the QStash path reads `resumeAsyncTool`/`approvedToolCall`/… as undefined
    // and never resumes a parked op. (The local queue spreads payload itself.)
    const {
      operationId,
      stepIndex = 0,
      context,
      humanInput,
      approvedToolCall,
      rejectionReason,
      rejectAndContinue,
      resumeAsyncTool,
      finishAfterAsyncTool,
      groupMemberTimeout,
      toolMessageId,
      verifyAsyncToolBarrier,
      asyncToolVerifyAttempt,
    } = { ...body, ...body.payload };

    if (!operationId) {
      return c.json({ error: 'operationId is required' }, 400);
    }

    log(`[${operationId}] Starting step ${stepIndex}`);

    // Get userId from operation metadata stored in Redis
    const coordinator = new AgentRuntimeCoordinator();
    const metadata = await coordinator.getOperationMetadata(operationId);

    if (!metadata?.userId) {
      const dbRow = await getOperationRowDiagnostic(operationId);
      const diagnostic = {
        dbRow,
        event: 'agent.run_step.missing_operation_metadata',
        metadataHasUserId: Boolean(metadata?.userId),
        metadataPresent: Boolean(metadata),
        operationId,
        qstashMessageId: getQStashMessageId(c),
        stepIndex,
        upstashRetried: c.req.header('upstash-retried') ?? null,
      };

      log(`[${operationId}] Invalid operation or no userId found: %O`, diagnostic);
      console.warn(JSON.stringify(diagnostic));
      return c.json({ error: 'Invalid operation or unauthorized' }, 401);
    }

    const serverDB = await getServerDB();
    // Step through AiAgentService so the runtime keeps its `execSubAgent`
    // fork callback (needed by `lobe-agent.callSubAgent`). In QStash mode every
    // step is a fresh HTTP request, and a bare AgentRuntimeService would lose the
    // in-process callback → SUB_AGENT_UNAVAILABLE.
    //
    // Thread the operation's workspace through so the runtime's models stay
    // workspace-scoped. Without it the worker is personal-scoped and the
    // parent-message lookup misses workspace-scoped rows → ConversationParentMissing.
    const aiAgentService = new AiAgentService(serverDB, metadata.userId, {
      workspaceId: metadata.workspaceId,
    });

    const result = await aiAgentService.executeStep({
      approvedToolCall,
      asyncToolVerifyAttempt,
      context,
      externalRetryCount,
      humanInput,
      finishAfterAsyncTool,
      groupMemberTimeout,
      operationId,
      rejectAndContinue,
      rejectionReason,
      resumeAsyncTool,
      stepIndex,
      toolMessageId,
      verifyAsyncToolBarrier,
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

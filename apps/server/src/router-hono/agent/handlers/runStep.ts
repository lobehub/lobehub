import debug from 'debug';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';
import { agentOperations } from '@/database/schemas/agentOperations';
import { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import type { AgentExecutionResult, AgentStepContinuation } from '@/server/services/agentRuntime';
import { isInlineAgentStepsEnabledForUser } from '@/server/services/agentRuntime/inlineStepsGate';
import { AiAgentService } from '@/server/services/aiAgent';

const log = debug('lobe-server:agent:run-step');

/**
 * Latest point in an invocation at which a new step may START, in ms.
 *
 * Every step boundary used to cost a full queue round-trip — measured at ~2.9s
 * p50 across production traces, which is 13% of all agent-run wall time and
 * more than a quarter of it for multi-step operations. Running consecutive
 * steps inside one invocation removes that cost; this deadline is what keeps
 * the invocation inside the platform's function timeout.
 *
 * It must stay comfortably below the route's `maxDuration`, because a step that
 * starts just under the deadline still runs to completion — production LLM
 * steps are ~42s at p90 and ~125s at p99. The 450s default leaves ~150s of
 * headroom under a 600s `maxDuration`, which covers p99. Raise it only
 * alongside `maxDuration`. Once past the deadline the pending step goes back to
 * the queue and a fresh invocation picks it up.
 */
const INLINE_STEP_START_DEADLINE_MS = Number(process.env.AGENT_INLINE_STEP_DEADLINE_MS ?? 450_000);

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
      lockRetryAttempt,
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
    // Opt into agent-share visitor rows only when this op is a shared-agent
    // visitor run — signalled by `streamOwnerUserId` (set on the operation
    // metadata when the visitor owns the stream but the run executes as the
    // creator `userId`). Ordinary creator runs keep the default exclusion.
    const includeShareVisitor = Boolean(metadata.streamOwnerUserId);
    const aiAgentService = new AiAgentService(serverDB, metadata.userId, {
      includeShareVisitor,
      workspaceId: metadata.workspaceId,
    });

    // ===== Inline step loop =====
    // Keep stepping inside this invocation for as long as the operation has a
    // next step ready and the deadline allows, instead of paying a queue
    // round-trip per step. One lock owner spans the whole loop: the operation
    // lock is re-entrant for its owner, so a redelivery from the queue still
    // loses the race the same way it does for a single step.
    // Rollout switch, resolved once per invocation from RuntimeConfig (Redis,
    // cached ~5s per instance). Off means exactly one step per delivery, which
    // is what the worker has always done.
    const inlineEnabled = await isInlineAgentStepsEnabledForUser(metadata.userId);

    const stepLockOwner = aiAgentService.createOperationLockOwner(operationId);
    let pendingContinuation: AgentStepContinuation | undefined;
    let currentStepIndex = stepIndex;
    let inlinedSteps = 0;
    let result: AgentExecutionResult;
    // True once this invocation has an envelope to account for: either it
    // resumed from one, or a step handed back a continuation (which parks one).
    let touchedEnvelope = false;

    // Only a plain "run the next step" delivery may be redirected to a parked
    // envelope. Anything carrying its own purpose — an approval, a resume, a
    // watchdog probe — has to run as itself: redirecting it would drop that
    // payload and silently turn it into an ordinary step. The group-member
    // timeout is the sharp edge, because it is always scheduled at stepIndex 0
    // on the member operation, so any envelope at all would swallow it and take
    // the running loop's recovery pointer down with it.
    const isPlainStepDelivery =
      humanInput === undefined &&
      approvedToolCall === undefined &&
      rejectionReason === undefined &&
      toolMessageId === undefined &&
      !rejectAndContinue &&
      !resumeAsyncTool &&
      !finishAfterAsyncTool &&
      !verifyAsyncToolBarrier &&
      !groupMemberTimeout;

    // Deliberately not gated on `inlineEnabled`: switching the flag off while
    // operations are mid-loop must not strand the ones that already have an
    // envelope parked and nothing queued behind them.
    // A previous invocation may have died part-way through its own inline loop.
    // It parks the envelope for each step before running it, so an envelope
    // ahead of the delivered index means exactly that: resume from there. Going
    // ahead with the delivered index instead would hit the `stepCount >
    // stepIndex` stale-delivery guard, get ACKed, and strand the operation with
    // nothing queued behind it.
    const parked = isPlainStepDelivery
      ? await coordinator.loadInlineResume<AgentStepContinuation>(operationId)
      : null;
    const resumeFrom = parked && parked.stepIndex > stepIndex ? parked : undefined;
    if (resumeFrom) {
      log(
        `[${operationId}] Delivered step ${stepIndex} is behind a parked inline step ${resumeFrom.stepIndex}; resuming there`,
      );
      currentStepIndex = resumeFrom.stepIndex;
      touchedEnvelope = true;
    }

    try {
      // The first iteration carries this delivery's one-shot payload (human
      // input, approvals, resume flags). Later iterations are plain steps, so
      // they must not replay any of it, and neither must a resumed run — it
      // stands in for a later iteration of a dead loop, not for the original
      // message.
      //
      // `externalRetryCount` is the exception, because it describes this
      // delivery rather than the step's payload. A parked approval whose Review
      // failed to persist is only replayed when the count is nonzero, so
      // dropping it here would leave that approval permanently unavailable.
      result = resumeFrom
        ? await aiAgentService.executeStep({
            context: resumeFrom.context,
            externalRetryCount,
            inlineContinuation: inlineEnabled,
            operationId,
            retainStepLock: true,
            stepIndex: resumeFrom.stepIndex,
            stepLockOwner,
          })
        : await aiAgentService.executeStep({
            approvedToolCall,
            asyncToolVerifyAttempt,
            context,
            externalRetryCount,
            finishAfterAsyncTool,
            groupMemberTimeout,
            humanInput,
            inlineContinuation: inlineEnabled,
            lockRetryAttempt,
            operationId,
            rejectAndContinue,
            rejectionReason,
            resumeAsyncTool,
            retainStepLock: true,
            stepIndex,
            stepLockOwner,
            toolMessageId,
            verifyAsyncToolBarrier,
          });
      pendingContinuation = result.continuation;
      touchedEnvelope ||= Boolean(pendingContinuation);

      while (pendingContinuation) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= INLINE_STEP_START_DEADLINE_MS) {
          log(
            `[${operationId}] Inline budget spent after ${inlinedSteps} extra step(s) (${elapsed}ms), handing step ${pendingContinuation.stepIndex} back to the queue`,
          );
          break;
        }

        const next = pendingContinuation;
        pendingContinuation = undefined;
        currentStepIndex = next.stepIndex;

        result = await aiAgentService.executeStep({
          context: next.context,
          inlineContinuation: inlineEnabled,
          operationId,
          retainStepLock: true,
          stepIndex: next.stepIndex,
          stepLockOwner,
        });
        inlinedSteps += 1;
        pendingContinuation = result.continuation;
        touchedEnvelope ||= Boolean(pendingContinuation);

        // A lock conflict mid-loop means another worker took over this
        // operation. Stop rather than fight it — that worker owns the rest.
        if (result.locked) break;
      }

      // Whatever is still pending goes back to the queue so the operation
      // resumes in a fresh invocation.
      if (pendingContinuation) {
        await aiAgentService.scheduleContinuation(pendingContinuation);
        result = { ...result, nextStepScheduled: true };
        pendingContinuation = undefined;
      }

      // Drop the envelope once this invocation is done with it: either the queue
      // owns the next step again, or the operation stopped. Leaving it behind
      // would let a late redelivery re-run a step someone else already owns.
      // Skipped when nothing was ever parked, to keep the flag-off path free of
      // an extra Redis round-trip.
      //
      // Scoped to our lock owner, because "done with it" is only true while we
      // still hold the operation. A delivery that read an envelope and then lost
      // the lock race must not delete the newer one the live worker parked.
      if (touchedEnvelope) {
        await coordinator.clearInlineResume(operationId, stepLockOwner);
      }
    } finally {
      // Owner-scoped, so this is a no-op when the first step never claimed the
      // lock (a conflicting delivery, a terminal operation, a watchdog probe).
      await aiAgentService.releaseOperationLock(operationId, stepLockOwner);
    }

    // A non-stale lock conflict means another delivery is still executing this
    // operation. Once the inline loop has run steps of its own the delivery has
    // already done real work and the conflict just means another worker picked
    // up the rest, so report success instead of asking for a redelivery that the
    // stale-step guard would drop anyway.
    if (result.locked && inlinedSteps === 0) {
      // The runtime already re-queued this step on its own backoff, which can
      // outlast a step that holds the lock for minutes. ACK so QStash doesn't
      // retry on top of that and dead-letter the delivery once its (much
      // shorter) retry budget runs out.
      if (result.lockRescheduled) {
        log(`[${operationId}] Step ${stepIndex} locked by another instance, re-queued`);
        return c.json({
          locked: true,
          nextStepScheduled: true,
          operationId,
          stepIndex,
          success: true,
        });
      }

      // Backoff exhausted (or re-queueing failed) — fall back to a retryable
      // response so the delivery still gets whatever retries the queue offers.
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
      inlinedSteps,
      nextStepIndex: result.nextStepScheduled ? currentStepIndex + 1 : undefined,
      nextStepScheduled: result.nextStepScheduled,
      operationId,
      pendingApproval: result.state.pendingToolsCalling,
      pendingPrompt: result.state.pendingHumanPrompt,
      pendingSelect: result.state.pendingHumanSelect,
      status: result.state.status,
      stepIndex: currentStepIndex,
      success: result.success,
      totalCost: result.state.cost?.total || 0,
      totalSteps: result.state.stepCount,
      waitingForHuman: result.state.status === 'waiting_for_human',
    };

    log(
      `[${operationId}] Steps ${stepIndex}..${currentStepIndex} completed (${executionTime}ms, ${inlinedSteps} inlined, status: ${result.state.status})`,
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

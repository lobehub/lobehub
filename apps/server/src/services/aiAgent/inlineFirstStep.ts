import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer as agentRuntimeTracer } from '@lobechat/observability-otel/modules/agent-runtime';
import debug from 'debug';

import { getServerFeatureFlagsStateFromRuntimeConfig } from '@/server/featureFlags';
import type { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';
import { STEP_LOCK_TTL_SECONDS } from '@/server/services/agentRuntime/AgentRuntimeService/constants';
import {
  scheduleOpportunisticStaleSweep,
  scheduleOpportunisticVerifySweep,
} from '@/server/services/agentRuntime/opportunisticSweep';

import { runStepInvocation, type StepInvocationService } from './stepInvocation';

const log = debug('lobe-server:agent:inline-first-step');

/**
 * When the host kills the `execAgent` invocation, counted from the request.
 *
 * `execAgent` is served by the tRPC lambda route, which declares no
 * `maxDuration` of its own and so runs under the deployment's default, not the
 * 600s the step worker (`/api/agent/run`) budgets for. 300s is the Vercel
 * default; set this to the deployment's real limit when it differs.
 */
export const INLINE_FIRST_STEP_MAX_DURATION_MS = Number(
  process.env.AGENT_INLINE_FIRST_STEP_MAX_DURATION_MS ?? 300_000,
);

/**
 * Latest point in the `execAgent` invocation at which another step may START,
 * counted from the request. Step 0 always starts (a second or two in); later
 * steps run inline only while this allows and are handed to the queue after,
 * exactly as the step worker does with its own deadline. The headroom to
 * {@link INLINE_FIRST_STEP_MAX_DURATION_MS} has to cover one long LLM step.
 */
export const INLINE_FIRST_STEP_START_DEADLINE_MS = Number(
  process.env.AGENT_INLINE_FIRST_STEP_DEADLINE_MS ?? 120_000,
);

/** A flag that cannot be read keeps step 0 on the queue. */
export const isInlineFirstStepEnabled = async (userId: string): Promise<boolean> => {
  const flags = await getServerFeatureFlagsStateFromRuntimeConfig(userId).catch(() => undefined);
  return flags?.enableInlineFirstStep === true;
};

export interface InlineFirstStepGateInput {
  /** Whether this send left its init to step 0 (`shouldDeferOperationInit`). */
  deferredInit: boolean;
  /**
   * The route serving the send asked for it and said when its request started.
   * Only `aiAgent.execAgent` does: other callers run inside invocations whose
   * clock they do not know (a step worker draining a queued follow-up, a bot
   * webhook) or are not a person waiting at the composer.
   */
  requestStartedAt?: number;
  /** The run's first step index. A deferred init always starts at 0. */
  stepIndex: number;
}

/**
 * Only a send that deferred its init runs step 0 inline. That gate already
 * limits it to a plain chat send on the queue runtime with auto-start: no
 * orchestration (bots, group members, sub-agents, evals, share visitors,
 * reserved or continuation operations), no resume or approval, no fixed or
 * required device.
 *
 * The flag is read last, so runs that could never inline pay no read for it.
 */
export const shouldRunFirstStepInline = async (
  { deferredInit, requestStartedAt, stepIndex }: InlineFirstStepGateInput,
  isEnabled: () => Promise<boolean>,
): Promise<boolean> =>
  deferredInit &&
  requestStartedAt !== undefined &&
  stepIndex === 0 &&
  (await isEnabled().catch(() => false));

export interface InlineFirstStepRun {
  operationId: string;
  /** When the `execAgent` request started, in epoch ms: the invocation's clock. */
  requestStartedAt: number;
  stepIndex: number;
}

/** What became of an inline step 0. */
export type InlineFirstStepOutcome =
  /** The queued delivery already ran the step before the inline run got to it. */
  | 'already_ran'
  /** The queued delivery holds the step; it runs it. */
  | 'claim_lost'
  /** The step loop threw; the queued delivery stands in for the redelivery. */
  | 'failed'
  /** No runtime metadata or state: the queued delivery settles the run as the worker does. */
  | 'missing_operation'
  | 'ran';

export interface InlineFirstStepDeps {
  coordinator: Pick<
    AgentRuntimeCoordinator,
    | 'clearInlineResume'
    | 'getOperationMetadata'
    | 'loadAgentState'
    | 'loadInlineResume'
    | 'markInlineFirstStepSettled'
    | 'tryClaimStep'
  >;
  /**
   * The service the step runs through, built from the operation's runtime
   * metadata exactly as the step worker builds it — never the one that served
   * the send, whose request-scoped options do not belong to the run.
   */
  createService: (metadata: {
    streamOwnerUserId?: string;
    userId: string;
    workspaceId?: string;
  }) => StepInvocationService;
}

/**
 * Run step 0 of a just-created operation in the `execAgent` invocation, after
 * its response, instead of waiting for the queue to deliver it.
 *
 * It takes the same operation lock a queue delivery takes, before anything
 * else, so it and the queued fallback delivery cannot both run the step:
 * whichever claims first runs it, and the other finds it held or already run.
 * Once the step loop returns, it marks the step settled, which turns the
 * fallback into a no-op. When it throws (a lost lock, an unreadable durable
 * status, a Review that failed to persist), the marker is not written and the
 * fallback runs as the queue's redelivery of step 0 would.
 *
 * The step itself is the worker's `executeStep`, so Stop, a failed deferred
 * init and a revoked share behave exactly as they do there. Never rejects.
 */
export const runInlineFirstStep = (
  deps: InlineFirstStepDeps,
  { operationId, requestStartedAt, stepIndex }: InlineFirstStepRun,
): Promise<InlineFirstStepOutcome> =>
  agentRuntimeTracer.startActiveSpan('agent.inline_first_step', async (span) => {
    const { coordinator } = deps;
    span.setAttributes({
      'lobehub.agent_step.operation_id': operationId,
      'lobehub.agent_step.since_request_ms': Date.now() - requestStartedAt,
    });
    const finish = (outcome: InlineFirstStepOutcome) => {
      span.setAttribute('lobehub.agent_step.inline_first_step_outcome', outcome);
      log('[%s] inline step %d: %s', operationId, stepIndex, outcome);
      return outcome;
    };

    try {
      // The step worker rides every delivery to run these background repairs;
      // a run that finishes inline may never reach that worker.
      scheduleOpportunisticStaleSweep();
      scheduleOpportunisticVerifySweep();

      const metadata = await coordinator.getOperationMetadata(operationId);
      if (!metadata?.userId) return finish('missing_operation');

      const service = deps.createService({
        streamOwnerUserId: metadata.streamOwnerUserId,
        userId: metadata.userId,
        workspaceId: metadata.workspaceId,
      });
      const stepLockOwner = service.createOperationLockOwner(operationId);
      const claimed = await coordinator.tryClaimStep(
        operationId,
        stepIndex,
        STEP_LOCK_TTL_SECONDS,
        stepLockOwner,
      );
      // Not `executeStep`'s own claim: on a conflict it re-queues the delivery,
      // and here the conflict means the queued delivery already owns the step.
      if (!claimed) return finish('claim_lost');

      let handedToLoop = false;
      try {
        const state = await coordinator.loadAgentState(operationId);
        if (!state) return finish('missing_operation');
        // Ran and released before this run started; running it again here
        // would only publish a stray `step_start` before the stale-step guard.
        if (state.stepCount > stepIndex) return finish('already_ran');

        handedToLoop = true;
        const { inlinedSteps, result } = await runStepInvocation(
          service,
          coordinator,
          {
            // What the queued delivery carries: the placeholder saved on the state.
            context: (state as AgentState & { initialContext?: AgentRuntimeContext })
              .initialContext,
            firstStepDispatch: 'inline',
            operationId,
            stepIndex,
          },
          {
            invocationDeadlineAt: requestStartedAt + INLINE_FIRST_STEP_MAX_DURATION_MS,
            // Bounds the steps after step 0 only: the first one always runs.
            stepStartDeadlineAt: requestStartedAt + INLINE_FIRST_STEP_START_DEADLINE_MS,
          },
          { stepLockOwner },
        );
        await coordinator.markInlineFirstStepSettled(operationId);

        span.setAttributes({
          'lobehub.agent_step.inlined_steps': inlinedSteps,
          'lobehub.agent_step.next_step_queued': Boolean(result.nextStepScheduled),
          ...(result.state?.status ? { 'lobehub.agent_step.status': result.state.status } : {}),
        });
        return finish('ran');
      } finally {
        if (!handedToLoop) await service.releaseOperationLock(operationId, stepLockOwner);
      }
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error)?.message });
      console.error('[inline-first-step] step %d of %s failed: %O', stepIndex, operationId, error);
      return finish('failed');
    } finally {
      span.end();
    }
  });

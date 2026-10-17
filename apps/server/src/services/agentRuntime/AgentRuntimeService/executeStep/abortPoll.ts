import debug from 'debug';

import type { AgentRuntimeService } from '..';
import {
  LEGACY_INTERRUPT_STATE_POLL_INTERVAL_MS,
  STEP_ABORT_POLL_INTERVAL_MS,
  STEP_ABORT_POLL_MAX_BACKOFF,
} from '../constants';

const log = debug('lobe-server:agent-runtime-service');

export interface StepAbortPoll {
  signal: AbortSignal;
  /** Stop polling. Called from the step's `finally` on every exit path. */
  stop: () => void;
}

export function startStepAbortPoll(
  svc: AgentRuntimeService,
  operationId: string,
  stepIndex: number,
): StepAbortPoll {
  // Hoisted so the shared `finally` can stop it on every exit path — an
  // orphaned interval would keep polling Redis for a step that is long gone.
  let stepAbortPoll: ReturnType<typeof setTimeout> | undefined;
  // Clearing the timeout is not enough: a poll already awaiting the state read
  // would schedule the next one after the step is gone, leaking a loop that
  // re-reads the store forever for a finished operation.
  let stepAbortPollStopped = false;

  // Interrupts arrive as a sentinel key beside the persisted state — the
  // request that asked for the stop runs in a different invocation, so
  // there is no in-process controller to share. Poll while the step is alive
  // and cancel locally, otherwise a multi-minute tool would keep running
  // long after the user asked it to stop.
  const stepAbortController = new AbortController();
  // Serialized on purpose: `setInterval` would fire a new read without
  // waiting for the last one, so a slow or failing state store turns every
  // concurrent run into a growing pile of overlapping requests — the load
  // spikes exactly when the store is already struggling. Each read is
  // scheduled only after the previous one settles, and failures back off.
  let abortPollFailures = 0;
  let lastLegacyInterruptStatePollAt = Date.now();
  const pollForAbort = async () => {
    try {
      // Prefer the sentinel. During the first rolling deployment, an old
      // worker can still write only the authoritative state, so sample
      // that large blob at a much lower cadence until all writers have
      // sentinel support.
      let interrupted = await svc.coordinator.isInterrupted(operationId);
      const now = Date.now();
      if (
        !interrupted &&
        now - lastLegacyInterruptStatePollAt >= LEGACY_INTERRUPT_STATE_POLL_INTERVAL_MS
      ) {
        lastLegacyInterruptStatePollAt = now;
        interrupted = (await svc.coordinator.loadAgentState(operationId))?.status === 'interrupted';
      }
      abortPollFailures = 0;
      if (interrupted) {
        stepAbortController.abort();
        return;
      }
    } catch (error) {
      abortPollFailures += 1;
      log('[%s][%d] Abort poll failed: %O', operationId, stepIndex, error);
    }

    if (stepAbortPollStopped || stepAbortController.signal.aborted) return;

    stepAbortPoll = setTimeout(
      pollForAbort,
      STEP_ABORT_POLL_INTERVAL_MS * Math.min(2 ** abortPollFailures, STEP_ABORT_POLL_MAX_BACKOFF),
    );
  };
  stepAbortPoll = setTimeout(pollForAbort, STEP_ABORT_POLL_INTERVAL_MS);

  return {
    signal: stepAbortController.signal,
    stop: () => {
      stepAbortPollStopped = true;
      if (stepAbortPoll) clearTimeout(stepAbortPoll);
    },
  };
}

import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import type { AgentRunInitRequest } from '@lobechat/types';
import debug from 'debug';

import type { AgentOperationModel } from '@/database/models/agentOperation';
import type { AgentRuntimeCoordinator } from '@/server/modules/AgentRuntime';

import type { AgentExecutionResult } from '../../types';
import { isTerminalAgentStatus, loadTerminalDurableStatus } from '../terminalStatus';

const log = debug('lobe-server:agent-runtime-service');

/**
 * Run the init an operation was created without: tool discovery and the
 * message / context assembly for `state.request`. Returns the state slots they
 * produce, which the step merges before executing.
 *
 * Implemented by AiAgentService (it owns the pipeline and the models it needs);
 * the runtime only knows when to ask and what to do with the answer.
 */
export type DeferredInitRunner = (params: {
  operationId: string;
  request: AgentRunInitRequest;
  state: AgentState;
}) => Promise<{
  /**
   * The context step 0 must run with. The step was queued before the init
   * existed, so the context it carries is a placeholder — the assembled base
   * context (and an approval resume's phase) only exists after init.
   */
  context: AgentRuntimeContext;
  state: Partial<AgentState>;
}>;

export interface DeferredInitDeps {
  /** Terminate a shared run whose authorization was revoked. */
  abortShareRun: (state: AgentState) => Promise<AgentExecutionResult>;
  agentOperationModel: AgentOperationModel;
  coordinator: AgentRuntimeCoordinator;
  isShareRunRevoked: (state: AgentState) => Promise<boolean>;
  runDeferredInit?: DeferredInitRunner;
  /** Settle a step that will not run: completion signals and hooks, no step event. */
  settleSkippedStep: (state: AgentState) => Promise<AgentExecutionResult>;
}

/** Either the step ends here with `result`, or it proceeds with `context` (when the init ran). */
export type DeferredInitOutcome =
  | { context: AgentRuntimeContext; result?: undefined }
  | { context?: undefined; result: AgentExecutionResult };

/**
 * Make a stop that landed before (or during) a deferred init durable. The
 * interrupt may have written only its sentinel before crashing, and the
 * completion lifecycle does not own the runtime-state transition: the
 * coordinator save does, and it is also what publishes `agent_runtime_end`
 * exactly once. Idempotent for a state that is already interrupted.
 */
const persistStopBeforeInit = async (
  coordinator: AgentRuntimeCoordinator,
  operationId: string,
  state: AgentState,
): Promise<void> => {
  const alreadyPersisted =
    (await coordinator.loadAgentState(operationId))?.status === 'interrupted';
  state.status = 'interrupted';
  if (alreadyPersisted) return;
  await coordinator.saveAgentState(operationId, {
    ...state,
    lastModified: new Date().toISOString(),
    status: 'interrupted',
  });
};

/**
 * Whether the run stopped being this worker's while its init was awaited, and
 * if so, the outcome that settles it. Stop can land during the init, and the
 * abort poll is not armed yet: saving this worker's pre-init `running` state
 * would overwrite the interrupted one and walk straight into LLM work, so
 * re-read before writing anything. The init can also outlive the inactivity
 * watchdog: abandonment (or a recovery that replaced this run) settles the
 * operation, its lifecycle included, and may delete the runtime state. A
 * missing state, a terminal one, or a terminal durable row all mean the run is
 * no longer this worker's.
 */
const settleIfReleasedDuringInit = async (
  deps: DeferredInitDeps,
  {
    agentState,
    operationId,
    stepIndex,
  }: { agentState: AgentState; operationId: string; stepIndex: number },
  initOutcome: 'failed' | 'finished',
): Promise<DeferredInitOutcome | undefined> => {
  const { coordinator } = deps;
  const latest = await coordinator.loadAgentState(operationId);
  if ((await coordinator.isInterrupted(operationId)) || latest?.status === 'interrupted') {
    log(
      '[%s][%d] Interrupted while the deferred init ran (init %s); settling the stop',
      operationId,
      stepIndex,
      initOutcome,
    );
    await persistStopBeforeInit(coordinator, operationId, latest ?? agentState);
    Object.assign(agentState, latest ?? {}, { status: 'interrupted' });
    return { result: await deps.settleSkippedStep(agentState) };
  }

  const endedStatus = !latest
    ? 'missing'
    : isTerminalAgentStatus(latest.status)
      ? latest.status
      : await loadTerminalDurableStatus(deps.agentOperationModel, operationId, stepIndex);
  if (endedStatus) {
    log(
      '[%s][%d] Operation ended while the deferred init ran (%s, init %s); dropping it',
      operationId,
      stepIndex,
      endedStatus,
      initOutcome,
    );
    return {
      result: { nextStepScheduled: false, state: latest ?? {}, stepResult: null, success: true },
    };
  }

  return undefined;
};

/**
 * The run may have been created without its init — the send path returned as
 * soon as the messages were durable and left discovery and the context
 * assembly to this worker. The turn's request is still on the state, which is
 * exactly what says the init has not run yet; call this only when it is.
 *
 * It runs after the step claim, so two deliveries of step 0 cannot both pay for
 * a discovery, and before anything is published, so the client sees one
 * `step_start` for a fully initialized run. A failure here rejects into the
 * step error handler: the operation ends with the error on its assistant
 * message, which is the only honest outcome once the user has already been told
 * the message was sent.
 *
 * Mutates `agentState` in place, as the step does with the state it loaded.
 */
export const runPendingInit = async (
  deps: DeferredInitDeps,
  params: {
    agentState: AgentState;
    operationId: string;
    /** The turn's request still on `agentState`. */
    request: AgentRunInitRequest;
    stepIndex: number;
  },
): Promise<DeferredInitOutcome> => {
  const { coordinator } = deps;
  const { agentState, operationId, request, stepIndex } = params;

  if (isTerminalAgentStatus(agentState.status)) {
    // The run ended before its init ran — typically a Stop whose writes
    // all landed first. That save already published
    // `agent_runtime_end`, so settle here, before `step_start`, and do
    // not persist the terminal state a second time.
    log(
      '[%s][%d] Operation already %s before deferred init; skipping it',
      operationId,
      stepIndex,
      agentState.status,
    );
    return { result: await deps.settleSkippedStep(agentState) };
  }

  if (await coordinator.isInterrupted(operationId)) {
    // Stop pressed during the init window. Skip the discovery nobody is
    // waiting for, but still settle the run: the state may read
    // `running` if the interrupt landed only its sentinel before a
    // crash. Return before `step_start` — persisting the stop publishes
    // `agent_runtime_end`, and no step event may follow it.
    log('[%s][%d] Interrupted before deferred init; skipping it', operationId, stepIndex);
    await persistStopBeforeInit(coordinator, operationId, agentState);
    return { result: await deps.settleSkippedStep(agentState) };
  }

  // A shared-agent run revoked between enqueue and step 0 must not
  // get creator-scoped discovery and history/persona assembly first:
  // the per-step authorization re-check comes too late for that.
  if (await deps.isShareRunRevoked(agentState)) {
    return { result: await deps.abortShareRun(agentState) };
  }

  if (!deps.runDeferredInit) {
    throw new Error(`Operation ${operationId} needs a deferred init but no runner is wired`);
  }

  const initStartedAt = Date.now();
  let initialized: Awaited<ReturnType<DeferredInitRunner>>;
  try {
    initialized = await deps.runDeferredInit({
      operationId,
      request,
      state: agentState,
    });
  } catch (error) {
    // A failure is only this worker's to report while it still owns the run.
    // A Stop (or an abandonment) that landed while the init was awaited wins:
    // the step error handler would overwrite it with `error`.
    const released = await settleIfReleasedDuringInit(deps, params, 'failed');
    if (released) return released;
    throw error;
  }

  const released = await settleIfReleasedDuringInit(deps, params, 'finished');
  if (released) return released;

  // One write: the initialized slots, the assembled context (a
  // redelivery after this save finds the request gone and must still
  // start from it), and the cleared request (so that redelivery does
  // not pay for discovery again).
  Object.assign(agentState, initialized.state, {
    initialContext: initialized.context,
    request: undefined,
  });
  await coordinator.saveAgentState(operationId, agentState);

  // The checks above and this save are not atomic: a Stop landing in
  // between has already written its sentinel and interrupted state
  // (publishing `agent_runtime_end`), which the save just overwrote
  // with `running`. Re-check the sentinel once more and, if it is
  // set, put the stop back and settle without a step event. A Stop
  // after this point lands on the saved state and is handled like
  // any Stop during a step.
  if (await coordinator.isInterrupted(operationId)) {
    log(
      '[%s][%d] Interrupted while the deferred init was saved; restoring the stop',
      operationId,
      stepIndex,
    );
    await persistStopBeforeInit(coordinator, operationId, agentState);
    return { result: await deps.settleSkippedStep(agentState) };
  }

  log(
    '[%s][%d] Deferred init finished in %dms',
    operationId,
    stepIndex,
    Date.now() - initStartedAt,
  );
  return { context: initialized.context };
};

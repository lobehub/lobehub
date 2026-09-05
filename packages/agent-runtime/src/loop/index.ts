import type { AgentRuntimeContext, AgentState } from '../types';
import { isParkedStatus } from '../utils/status';

/**
 * Why a loop stopped.
 *
 * Every host re-derived this after the fact — the server to decide whether to
 * emit `max_steps` completion signals, the client to choose between a terminal
 * lifecycle event and the parked one. Making it the loop's output is the point
 * of this module: a stop reason that is computed once cannot drift between
 * hosts the way the termination conditions did.
 */
export type AgentLoopStopReason =
  | 'done'
  | 'error'
  | 'interrupted'
  /** Non-terminal pause: human approval, or an async tool / sub-agent result. */
  | 'parked'
  /** Cost budget exhausted and configured to stop. */
  | 'cost_limit'
  /** The caller's step budget, distinct from `state.maxSteps`. */
  | 'max_steps'
  /** The step produced nothing to feed the next one. */
  | 'no_next_context';

export interface AgentLoopStepInput {
  context?: AgentRuntimeContext;
  state: AgentState;
  /** Zero-based index of the step about to run. */
  stepIndex: number;
}

export interface AgentLoopStepResult {
  nextContext?: AgentRuntimeContext;
  state: AgentState;
}

/**
 * One step, supplied by the host.
 *
 * The loop deliberately does NOT call `runtime.step` itself. A step means very
 * different things per host — on the server it claims a distributed lock,
 * persists state, dispatches hooks and records a trace; in the browser and on a
 * device it is a direct `runtime.step`. Collapsing those into one function is
 * how a shared loop turns into something every host has to work around.
 */
export type AgentLoopStep = (input: AgentLoopStepInput) => Promise<AgentLoopStepResult>;

export interface RunAgentLoopOptions {
  initialContext?: AgentRuntimeContext;
  /**
   * Caller-imposed step budget. Separate from `state.maxSteps`, which
   * `runtime.step` enforces by forcing the state to `done`.
   */
  maxSteps?: number;
  onStepComplete?: (stepIndex: number, state: AgentState) => Promise<void> | void;
  /**
   * Replaces the built-in stop check. Return a reason to stop, or `undefined`
   * to continue — for a host with an extra termination condition of its own.
   */
  resolveStop?: (
    state: AgentState,
    context?: AgentRuntimeContext,
  ) => AgentLoopStopReason | undefined;
  state: AgentState;
  step: AgentLoopStep;
}

export interface AgentLoopResult {
  context?: AgentRuntimeContext;
  reason: AgentLoopStopReason;
  state: AgentState;
  /** Steps actually executed by this loop. */
  stepCount: number;
}

/**
 * Stop conditions that depend only on the state itself.
 *
 * Separate from {@link resolveStopReason} because "no next context" is a
 * statement about what a step PRODUCED, and so cannot be asked before the
 * first step has run. A run legitimately starts with no context — the caller
 * either supplies one or lets the agent open the turn — and treating that as a
 * stop would end every loop before it began.
 */
export const resolveTerminalReason = (state: AgentState): AgentLoopStopReason | undefined => {
  if (state.status === 'done') return 'done';
  if (state.status === 'error') return 'error';
  if (state.status === 'interrupted') return 'interrupted';
  if (isParkedStatus(state.status)) return 'parked';

  // Exceeding the budget only stops a run that asked to be stopped; other
  // policies let it continue and settle up elsewhere.
  const costLimit = state.costLimit;
  if (
    costLimit &&
    (state.cost?.total ?? 0) >= costLimit.maxTotalCost &&
    costLimit.onExceeded === 'stop'
  )
    return 'cost_limit';

  return undefined;
};

/**
 * Decide whether a loop should stop after a step, and why.
 *
 * Extracted from the server's `shouldContinueExecution`, which was the only
 * complete statement of these rules; the browser approximated the same thing
 * with a `done`/`error` while-condition plus "no next context", and the two
 * agreed only by coincidence.
 *
 * `context` is the context the NEXT step would receive — absent means the
 * previous step produced nothing to continue from.
 */
export const resolveStopReason = (
  state: AgentState,
  context?: AgentRuntimeContext,
): AgentLoopStopReason | undefined =>
  resolveTerminalReason(state) ?? (context ? undefined : 'no_next_context');

/**
 * Drive an agent to a stopping point, one host-supplied step at a time.
 *
 * Owns exactly two things: when to stop, and what context the next step gets.
 * Everything inside a step — persistence, hooks, streaming, quota — stays with
 * the host, because those are what differ between the server, the browser and
 * a device.
 */
export const runAgentLoop = async (options: RunAgentLoopOptions): Promise<AgentLoopResult> => {
  const { initialContext, maxSteps, onStepComplete, resolveStop, state, step } = options;
  const stopCheck = resolveStop ?? resolveStopReason;

  let currentState = state;
  let currentContext = initialContext;
  let stepCount = 0;

  // Checked before the first step too — a state handed in already `done`,
  // `interrupted` or parked must not be stepped again, since resuming a parked
  // operation is a separate entry point rather than another turn of this loop.
  // Status only: a run may legitimately open with no context.
  let reason = resolveTerminalReason(currentState);

  while (!reason) {
    if (maxSteps !== undefined && stepCount >= maxSteps) return finish('max_steps');

    const result = await step({
      context: currentContext,
      state: currentState,
      stepIndex: stepCount,
    });

    currentState = result.state;
    currentContext = result.nextContext;
    stepCount += 1;

    await onStepComplete?.(stepCount, currentState);

    reason = stopCheck(currentState, currentContext);
  }

  return finish(reason);

  function finish(stopReason: AgentLoopStopReason): AgentLoopResult {
    return { context: currentContext, reason: stopReason, state: currentState, stepCount };
  }
};

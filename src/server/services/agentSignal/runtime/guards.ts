import type { RuntimeGuardResult, RuntimeProcessorResult } from '@lobechat/agent-signal';

import type { RuntimeProcessorContext } from './context';

/** Timing-guard input shared by the generalized runtime helpers. */
export interface RuntimeTimingGuardInput {
  lane: string;
  ms: number;
}

type RuntimeTimingGuardPhase = 'debounce' | 'throttle' | 'outer-timeout';

/**
 * Derives one phase-specific storage key from the public lane name.
 *
 * Before:
 * - `user-feedback`
 *
 * After:
 * - `user-feedback::debounce`
 */
const createPhaseScopedLane = (lane: string, phase: RuntimeTimingGuardPhase): string => {
  return `${lane}::${phase}`;
};

const createReadyResult = (): RuntimeGuardResult => {
  return {
    ok: true,
    reason: 'ready',
    wait: () => ({ status: 'wait' }),
  };
};

const createWaitResult = (
  input: RuntimeTimingGuardInput & {
    delayMs: number;
    reason: 'debounced' | 'throttled';
  },
): RuntimeGuardResult => {
  return {
    delayMs: input.delayMs,
    ok: false,
    reason: input.reason,
    wait: () =>
      ({
        pending: { lane: input.lane, reason: input.reason },
        status: 'wait',
      }) satisfies RuntimeProcessorResult,
  };
};

const createConcludeResult = (
  input: RuntimeTimingGuardInput & {
    elapsedMs: number;
    reason: 'timed_out';
  },
): RuntimeGuardResult => {
  return {
    ok: false,
    reason: input.reason,
    wait: () =>
      ({
        concluded: {
          elapsedMs: input.elapsedMs,
          lane: input.lane,
          reason: input.reason,
          timeoutMs: input.ms,
        },
        status: 'conclude',
      }) satisfies RuntimeProcessorResult,
  };
};

/** Debounces one lane inside the current runtime scope. */
export const debounce = async (
  ctx: RuntimeProcessorContext,
  input: RuntimeTimingGuardInput,
): Promise<RuntimeGuardResult> => {
  const lane = createPhaseScopedLane(input.lane, 'debounce');
  const state = await ctx.runtimeState.getGuardState(lane);
  const now = ctx.now();
  const elapsed = now - (state.lastEventAt ?? 0);

  if (state.lastEventAt && elapsed < input.ms) {
    await ctx.runtimeState.touchGuardState(lane, now);

    return createWaitResult({
      ...input,
      delayMs: input.ms,
      reason: 'debounced',
    });
  }

  await ctx.runtimeState.touchGuardState(lane, now);

  return createReadyResult();
};

/** Throttles one lane inside the current runtime scope. */
export const throttle = async (
  ctx: RuntimeProcessorContext,
  input: RuntimeTimingGuardInput,
): Promise<RuntimeGuardResult> => {
  const lane = createPhaseScopedLane(input.lane, 'throttle');
  const state = await ctx.runtimeState.getGuardState(lane);
  const now = ctx.now();
  const elapsed = now - (state.lastEventAt ?? 0);

  if (state.lastEventAt && elapsed < input.ms) {
    return createWaitResult({
      ...input,
      delayMs: input.ms - elapsed,
      reason: 'throttled',
    });
  }

  await ctx.runtimeState.touchGuardState(lane, now);

  return createReadyResult();
};

/** Enforces an outer timeout for one scoped lane. */
export const outerTimeout = async (
  ctx: RuntimeProcessorContext,
  input: RuntimeTimingGuardInput,
): Promise<RuntimeGuardResult> => {
  const lane = createPhaseScopedLane(input.lane, 'outer-timeout');
  const state = await ctx.runtimeState.getGuardState(lane);
  const now = ctx.now();

  if (typeof state.startedAt !== 'number') {
    await ctx.runtimeState.touchGuardState(lane, now);

    return createReadyResult();
  }

  const elapsed = now - state.startedAt;

  if (elapsed >= input.ms) {
    return createConcludeResult({
      ...input,
      elapsedMs: elapsed,
      reason: 'timed_out',
    });
  }

  return createReadyResult();
};

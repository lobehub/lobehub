import type { RuntimeProcessorContext } from '../runtime/context';

const ACTION_IDEMPOTENCY_LANE_PREFIX = 'action-idempotency';

/**
 * Creates the scope-local guard lane for one planned action idempotency key.
 *
 * Before:
 * - `source_1:memory:msg_1`
 *
 * After:
 * - `action-idempotency::source_1:memory:msg_1`
 */
export const createActionIdempotencyLane = (idempotencyKey: string) => {
  return `${ACTION_IDEMPOTENCY_LANE_PREFIX}::${idempotencyKey}`;
};

/**
 * Checks whether one action idempotency key has already been applied in the current runtime scope.
 *
 * Use when:
 * - An action handler must avoid replaying the same durable side effect
 * - The planner already emitted a stable `idempotencyKey`
 *
 * Expects:
 * - The key is stable across retries for the same intended side effect
 *
 * Returns:
 * - `true` when the action was already marked as applied
 * - `false` when the action should still execute
 */
export const hasAppliedActionIdempotency = async (
  ctx: RuntimeProcessorContext,
  idempotencyKey: string | undefined,
) => {
  if (!idempotencyKey) return false;

  const state = await ctx.runtimeState.getGuardState(createActionIdempotencyLane(idempotencyKey));

  return typeof state.lastEventAt === 'number';
};

/**
 * Marks one action idempotency key as successfully applied in the current runtime scope.
 *
 * Use when:
 * - An action handler finished its durable write and wants future retries to skip
 *
 * Expects:
 * - Callers only invoke this after the durable side effect succeeded
 *
 * Returns:
 * - The persisted runtime guard state for the idempotency lane
 */
export const markAppliedActionIdempotency = async (
  ctx: RuntimeProcessorContext,
  idempotencyKey: string | undefined,
) => {
  if (!idempotencyKey) return;

  await ctx.runtimeState.touchGuardState(createActionIdempotencyLane(idempotencyKey), ctx.now());
};

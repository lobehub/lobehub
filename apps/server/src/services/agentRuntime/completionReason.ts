/**
 * Terminal reasons for a run that was stopped by a cap or guard rather than
 * finishing naturally, but still produced its deliverable. They keep their own
 * label in `agent_operations.completion_reason` so they can be counted, and
 * are otherwise treated exactly like `done`: persisted with status `done`,
 * success-like for completion side effects.
 */
const CAPPED_COMPLETION_REASONS: ReadonlySet<string> = new Set([
  'cost_limit',
  'max_steps',
  'tool_call_repeat_limit',
  'tool_name_unresolved',
]);

/** Whether `reason` is a cap or guard stop that is recorded under its own label. */
export const isCappedCompletionReason = (reason: string): boolean =>
  CAPPED_COMPLETION_REASONS.has(reason);

/**
 * Terminal reasons treated as a successful completion: the run produced a
 * deliverable, even when it was stopped by a cap rather than finishing
 * naturally. Success-side effects (assistant-content recovery, file-Work
 * registration, Task settlement) must cover the capped reasons too — gating
 * them on `reason === 'done'` alone silently drops capped runs' artifacts.
 */
export const isSuccessLikeCompletionReason = (reason: string): boolean =>
  reason === 'done' || isCappedCompletionReason(reason);

/**
 * The reason a Task's run settles under. The Task lifecycle only knows `done`,
 * `error` and `interrupted`; a capped run reaching it under its own label falls
 * through every branch, keeps its run `running`, and is later failed by the
 * orphaned-run sweep although it delivered.
 */
export const taskRunSettleReason = (reason: string | undefined): string =>
  !reason || isSuccessLikeCompletionReason(reason) ? 'done' : reason;

/**
 * The states a person may put a goal in. The rest (planning / verifying /
 * review / failed) are the coordinator's verdicts, so they read as "running"
 * here and picking "running" on a closed goal reopens it.
 */
export type ManualGoalStatus = 'running' | 'paused' | 'achieved' | 'canceled';

export const MANUAL_STATUSES: ManualGoalStatus[] = ['running', 'paused', 'achieved', 'canceled'];

/** Same rule as the page's pause button: pausing only paces a goal that is moving. */
const PAUSABLE_STATUSES = new Set(['paused', 'planning', 'running', 'verifying']);

export const toManualStatus = (status: string | undefined): ManualGoalStatus | undefined => {
  // A draft is in none of the manual states yet; picking "running" starts it.
  if (status === 'draft') return;
  if (status === 'paused' || status === 'achieved' || status === 'canceled') return status;
  if (status === 'failed') return;
  return status ? 'running' : undefined;
};

/**
 * Whether a status choice would be refused or meaningless for this viewer.
 * Pausing a goal in review or already ended would overwrite that state without
 * pacing anything; closing interrupts runs, which the server only lets the
 * goal's creator or a workspace owner do.
 */
export const isStatusChoiceDisabled = (
  next: ManualGoalStatus,
  status: string | undefined,
  canClose: boolean,
): boolean => {
  if (next === 'paused') return !PAUSABLE_STATUSES.has(status ?? '');
  // Closing a draft would end a goal that never ran; delete it instead. Starting
  // it is allowed to the same people as closing: its creator or an owner.
  if (status === 'draft') return next !== 'running' || !canClose;
  if (next === 'achieved' || next === 'canceled') return !canClose;
  return false;
};

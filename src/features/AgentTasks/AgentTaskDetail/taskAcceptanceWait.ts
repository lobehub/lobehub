import type { TaskDetailActivity, TaskRunVerifySummary } from '@lobechat/types';

/**
 * Where a run that has stopped executing is waiting inside its acceptance round.
 *
 * - `awaitingEvidence`: the round is planned but its evidence has not arrived.
 * - `verifying`: the checks are being judged.
 * - `repairing`: the round did not pass and a repair round has to deliver again.
 * - `awaitingReview`: the round was delivered and waits for the person's review.
 * - `awaitingDecision`: the round ended without passing, but nothing moved the
 *   task on — only a person can decide what happens next.
 */
export type TaskAcceptanceWaitPhase =
  'awaitingDecision' | 'awaitingEvidence' | 'awaitingReview' | 'repairing' | 'verifying';

export interface TaskAcceptanceWait {
  acceptanceId: string | null;
  passed: number;
  phase: TaskAcceptanceWaitPhase;
  roundIndex: number | null;
  /** The run whose acceptance round holds the task. */
  topicId?: string;
  total: number;
}

const TERMINAL_RUN_STATUSES = new Set(['canceled', 'completed', 'failed', 'timeout']);

type RunActivity = Pick<
  TaskDetailActivity,
  'id' | 'runningOperation' | 'sourceTaskId' | 'status' | 'verify'
>;

const resolvePhase = (status: string | null): TaskAcceptanceWaitPhase | undefined => {
  switch (status) {
    case null:
    case 'collecting_evidence':
    case 'planned':
    case 'unverified': {
      return 'awaitingEvidence';
    }
    case 'running':
    case 'verifying': {
      return 'verifying';
    }
    case 'repairing': {
      return 'repairing';
    }
    case 'delivered': {
      return 'awaitingReview';
    }
    case 'errored':
    case 'failed': {
      return 'awaitingDecision';
    }
    // `passed` drives the task to completion on its own; any other value is not
    // a state we can explain, so claim nothing.
    default: {
      return undefined;
    }
  }
};

/**
 * The acceptance wait of one run whose agent has already stopped, if any.
 *
 * A run still holding a live operation is executing, whatever its round says.
 * A missing operation marker alone is not proof the run stopped: it is written
 * after the run starts. Phases past delivery only exist once the agent has
 * delivered, but a round still awaiting evidence also needs the run itself to
 * have reached a terminal status.
 */
export const resolveRunAcceptanceWait = (activity: RunActivity): TaskAcceptanceWait | undefined => {
  if (activity.runningOperation) return undefined;
  const verify: TaskRunVerifySummary | null | undefined = activity.verify;
  if (!verify) return undefined;

  const phase = resolvePhase(verify.status);
  if (!phase) return undefined;
  if (phase === 'awaitingEvidence' && !TERMINAL_RUN_STATUSES.has(activity.status ?? ''))
    return undefined;

  return {
    acceptanceId: verify.acceptanceId,
    passed: verify.passed,
    phase,
    roundIndex: verify.roundIndex,
    topicId: activity.id,
    total: verify.total,
  };
};

/**
 * Why a `running` task is not executing anything.
 *
 * A verify-bound run hands the completion decision to its acceptance round, so
 * the task stays `running` after the agent has stopped. Rendering that as
 * "in progress" hides the one thing the user can act on. Returns the round the
 * task waits on, or `undefined` while any run is still executing (or the task
 * is not `running`), so an executing task never reads as waiting.
 *
 * A parent's detail also lists its descendants' runs (`sourceTaskId`); only
 * the task's own runs decide.
 */
export const resolveTaskAcceptanceWait = (
  status: string | undefined,
  allTopics: RunActivity[],
  taskId?: string | null,
): TaskAcceptanceWait | undefined => {
  if (status !== 'running') return undefined;
  const topics = allTopics.filter((topic) => !topic.sourceTaskId || topic.sourceTaskId === taskId);
  if (topics.some((topic) => topic.runningOperation)) return undefined;

  // The newest round decides: an older round that is still open was superseded
  // by the run after it.
  const latestVerified = topics.findLast((topic) => topic.verify);
  return latestVerified ? resolveRunAcceptanceWait(latestVerified) : undefined;
};

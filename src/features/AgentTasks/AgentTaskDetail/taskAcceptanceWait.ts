import type {
  TaskDetailActivity,
  TaskDetailData,
  TaskDetailSubtask,
  TaskRunVerifySummary,
} from '@lobechat/types';

/**
 * Where a run that has stopped executing is waiting inside its acceptance round.
 *
 * - `awaitingEvidence`: the round is planned but its evidence has not arrived.
 * - `verifying`: the checks are being judged.
 * - `repairing`: the round did not pass and a repair round has to deliver again.
 * - `awaitingReview`: the round was delivered and waits for the person's review.
 */
export type TaskAcceptanceWaitPhase =
  'awaitingEvidence' | 'awaitingReview' | 'repairing' | 'verifying';

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
  'id' | 'runningOperation' | 'seq' | 'sourceTaskId' | 'status' | 'verify'
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
    // A settled round moves the task on by itself: `passed` completes it, and
    // `failed` / `errored` pause or complete it. A `running` task listing one
    // as its newest round is starting its next run, so claim nothing; the same
    // for any value we cannot explain.
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
  rootTaskId: string | null | undefined = taskId,
): TaskAcceptanceWait | undefined => {
  if (status !== 'running') return undefined;
  // Root runs carry no `sourceTaskId`; `seq` restarts per task, so order only
  // after keeping one task's runs.
  const topics = allTopics
    .filter((topic) => (topic.sourceTaskId ?? rootTaskId) === taskId)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  if (topics.some((topic) => topic.runningOperation)) return undefined;

  // The newest round decides: an older round that is still open was superseded
  // by the run after it. A newer run that has not ended is starting (its marker
  // is not written yet), so the task is executing, not waiting.
  const latestVerified = topics.findLast((topic) => topic.verify);
  if (!latestVerified) return undefined;
  const latest = topics.at(-1);
  if (latest !== latestVerified && !TERMINAL_RUN_STATUSES.has(latest?.status ?? '')) {
    return undefined;
  }
  return resolveRunAcceptanceWait(latestVerified);
};

const findSubtaskStatus = (
  subtasks: TaskDetailSubtask[] | undefined,
  taskId: string,
): string | undefined => {
  for (const subtask of subtasks ?? []) {
    if (subtask.id === taskId) return subtask.status;
    const nested = findSubtaskStatus(subtask.children, taskId);
    if (nested) return nested;
  }
  return undefined;
};

/**
 * The acceptance wait one run explains, if it is the round its owning task
 * waits on.
 *
 * A verify-bound run's topic is marked `completed` while its task stays
 * `running` until the round settles, so the run's own status cannot decide.
 * The owner is the task in view, or the descendant named by `sourceTaskId`.
 */
export const resolveRunAcceptanceWaitInTask = (
  detail: Pick<TaskDetailData, 'activities' | 'status' | 'subtasks'> | undefined,
  rootTaskId: string | null | undefined,
  run: Pick<TaskDetailActivity, 'id' | 'sourceTaskId'>,
): TaskAcceptanceWait | undefined => {
  if (!detail || !rootTaskId || !run.id) return undefined;
  const ownerId = run.sourceTaskId ?? rootTaskId;
  const ownerStatus =
    ownerId === rootTaskId ? detail.status : findSubtaskStatus(detail.subtasks, ownerId);
  const topics = (detail.activities ?? []).filter((activity) => activity.type === 'topic');
  const wait = resolveTaskAcceptanceWait(ownerStatus, topics, ownerId, rootTaskId);
  return wait?.topicId === run.id ? wait : undefined;
};

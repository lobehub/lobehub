import { isTaskArchiveBlocked } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { GoalModel } from '@/database/models/goal';
import { GoalGraphModel } from '@/database/models/goalGraph';
import type { LobeChatDatabase } from '@/database/type';

import { TERMINAL_GOAL_STATUSES } from '../goal/goalTraceRecorder';

interface ArchiveGuardTask {
  archivedAt?: Date | string | null;
  automationMode?: string | null;
  heartbeatInterval?: number | null;
  schedulePattern?: string | null;
  status: string;
}

/**
 * An archived task is hidden from every list, so it must stay idle: a patch or
 * status change that would leave it running, or with a schedule / heartbeat
 * that can fire, needs the task restored first. Uses the same rule that gates
 * archiving (`isTaskArchiveBlocked`), so the two directions can't disagree.
 */
export const assertArchivedTaskStaysIdle = (
  task: ArchiveGuardTask,
  change: Partial<Omit<ArchiveGuardTask, 'archivedAt'>>,
): void => {
  if (!task.archivedAt) return;

  const pick = <K extends keyof typeof change>(key: K) =>
    change[key] === undefined ? task[key] : change[key];
  const next = {
    automationMode: pick('automationMode'),
    heartbeatInterval: pick('heartbeatInterval'),
    schedulePattern: pick('schedulePattern'),
    status: pick('status') ?? task.status,
  };

  if (isTaskArchiveBlocked(next)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Restore this archived task before running or scheduling it',
    });
  }
};

/**
 * Run a task write in a transaction and check the row it returns. Postgres
 * serializes UPDATEs on one row: an archive that committed first is visible on
 * the returned row and the throw rolls this write back; a write that lands
 * first holds the row lock, and the archive's own guard then matches nothing.
 */
export const writeKeepingArchivedIdle = <T extends ArchiveGuardTask | null>(
  db: LobeChatDatabase,
  write: (tx: LobeChatDatabase) => Promise<T>,
): Promise<T> =>
  db.transaction(async (tx) => {
    const row = await write(tx as LobeChatDatabase);
    if (row) assertArchivedTaskStaysIdle(row, {});
    return row;
  });

const FINISHED_TASK_STATUSES = new Set(['canceled', 'completed']);

/**
 * An unfinished task owned by an open Goal is still on the Goal's plan: its
 * coordinator would keep claiming it, and the runner would keep refusing the
 * archived task, stalling the Goal. Such a task must wait until the Goal
 * finishes (or the task does). Throws CONFLICT so clients can tell it apart.
 */
export const assertNotInOpenGoal = async (
  db: LobeChatDatabase,
  scope: { userId: string; workspaceId?: string },
  task: { id: string; status: string },
): Promise<void> => {
  if (FINISHED_TASK_STATUSES.has(task.status)) return;

  const owner = await new GoalGraphModel(db, scope.userId, scope.workspaceId).findGoalByTaskId(
    task.id,
  );
  if (!owner) return;

  const goal = await new GoalModel(db, scope.userId, scope.workspaceId).findById(owner.id);
  if (goal && !TERMINAL_GOAL_STATUSES.has(goal.status)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This task is part of an active goal; finish or close the goal before archiving it',
    });
  }
};

import type { TaskProjectMoveRefusal } from '@lobechat/types';
import { t } from 'i18next';

import { normalizeAsyncError } from '@/libs/swr/normalizeError';

const REFUSAL_KEYS = {
  external_dependency: 'taskProject.moveRefusedDependency',
  filed_subtask: 'taskProject.moveRefusedFiledSubtask',
  filed_task: 'taskProject.moveRefusedSplitSubtasks',
  has_parent: 'taskProject.moveRefusedHasParent',
  split_subtasks: 'taskProject.moveRefusedSplitSubtasks',
} as const satisfies Record<TaskProjectMoveRefusal, string>;

/**
 * The toast title for a project move the server refused, or `undefined` for any
 * other failure. A refusal repeats on retry until its links change, and the
 * server's message is English-only, so the title names what blocks the move.
 * The reason arrives as `errorData.projectMoveRefusal` (see `projectMoveRefused`
 * on the server); a refusal without one falls back to a generic title.
 */
export const projectMoveRefusalTitle = (error: unknown): string | undefined => {
  if (normalizeAsyncError(error).code !== 'BAD_REQUEST') return undefined;
  const reason = (error as { data?: { errorData?: { projectMoveRefusal?: string } } })?.data
    ?.errorData?.projectMoveRefusal;
  // An unknown reason (a newer server) still gets the generic title.
  const key =
    reason && Object.hasOwn(REFUSAL_KEYS, reason)
      ? REFUSAL_KEYS[reason as TaskProjectMoveRefusal]
      : 'taskProject.moveFailed';
  return t(key, { ns: 'chat' });
};

import type { AcceptanceItem } from '@/database/schemas/verify';
import type { LobeChatDatabase } from '@/database/type';
import { GoalService } from '@/server/services/goal';

/**
 * A signed-off Goal-level acceptance closes its Goal for good, so the Goal's
 * finished Tasks are archived with it (see `GoalService.archiveSignedOffTasks`
 * for what qualifies). Called by every path that accepts an acceptance — the
 * sign-off actions and a merged pull request. Best-effort: the acceptance is
 * already recorded, so a failure here is logged, never thrown.
 */
export const archiveSignedOffGoalTasks = async (
  db: LobeChatDatabase,
  acceptance: Pick<AcceptanceItem, 'subjectId' | 'subjectType' | 'userId' | 'workspaceId'>,
): Promise<void> => {
  if (acceptance.subjectType !== 'task') return;
  try {
    await new GoalService(
      db,
      acceptance.userId,
      acceptance.workspaceId ?? undefined,
    ).archiveSignedOffTasks(acceptance.subjectId);
  } catch (error) {
    console.error('[goal:sign-off:archive-tasks]', error);
  }
};

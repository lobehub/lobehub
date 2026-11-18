import { isGoalArchiveBlocked } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useGoalStore } from '@/store/goal';

interface UseGoalArchiveToggleOptions {
  archivedAt?: Date | string | null;
  creatorUserId?: string | null;
  goalId: string;
  /** Runs after the archive lands, for hosts that render the goal from another read. */
  onArchived?: () => void;
  status?: string;
}

export interface GoalArchiveToggle {
  /** Why the archive is refused, or `undefined` when it may run. */
  deniedReason?: string;
  isArchived: boolean;
  label: string;
  /** Archives or restores; when refused, only repeats the reason. */
  toggle: () => Promise<void>;
}

/** Archive or restore a goal, shared by the detail header button and the list rows' menu. */
export const useGoalArchiveToggle = ({
  archivedAt,
  creatorUserId,
  goalId,
  onArchived,
  status,
}: UseGoalArchiveToggleOptions): GoalArchiveToggle => {
  const { t } = useTranslation('chat');
  // Archiving hides the goal from every list, so the server only lets the
  // creator or a workspace owner do it — the same rule as closing.
  const canManage = useResourceManageable(creatorUserId);
  const archiveGoal = useGoalStore((s) => s.archiveGoal);

  const isArchived = !!archivedAt;
  // Archived goals leave every list, so only a goal that is done with —
  // completed or canceled — may be put away. Restoring is always fine.
  const archiveBlocked = !isArchived && (!status || isGoalArchiveBlocked({ status }));
  const deniedReason = !canManage
    ? t('goalList.archiveDenied')
    : archiveBlocked
      ? t('goalList.archiveBlocked')
      : undefined;

  const toggle = useCallback(async () => {
    // A blocked button stays clickable so touch users, who get no tooltip, learn why.
    if (deniedReason) {
      toast.info(deniedReason);
      return;
    }
    try {
      await archiveGoal(goalId, !isArchived);
      toast.success(t(isArchived ? 'goalList.unarchiveSuccess' : 'goalList.archiveSuccess'));
      onArchived?.();
    } catch {
      toast.error(t(isArchived ? 'goalList.unarchiveFailed' : 'goalList.archiveFailed'));
    }
  }, [archiveGoal, deniedReason, goalId, isArchived, onArchived, t]);

  const label = t(isArchived ? 'goalList.unarchive' : 'goalList.archive');

  return useMemo(
    () => ({ deniedReason, isArchived, label, toggle }),
    [deniedReason, isArchived, label, toggle],
  );
};

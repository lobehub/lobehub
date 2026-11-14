import { ActionIcon, cssVar, DropdownMenu } from '@lobehub/ui';
import { ArchiveIcon, ArchiveRestoreIcon, MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { useGoalArchiveToggle } from './useGoalArchiveToggle';
import { useGoalMenuItems } from './useGoalMenuItems';

interface GoalDetailActionsProps {
  /** Absent for a goal with no responsible agent — e.g. one created from a project. */
  agentId?: string;
  archivedAt?: Date | string | null;
  goalId: string;
  /** Moves to the in-place title editor instead of opening the rename dialog. */
  onRename?: () => void;
  projectId?: string | null;
}

/** The detail header's archive button and "more" menu, beside the favorite star like a task's. */
const GoalDetailActions = memo<GoalDetailActionsProps>(
  ({ agentId, archivedAt, goalId, onRename, projectId }) => {
    const { t } = useTranslation('chat');
    const status = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.status);
    const creatorUserId = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.userId);
    const title = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.title);
    const archive = useGoalArchiveToggle({ archivedAt, creatorUserId, goalId, status });
    const items = useGoalMenuItems({
      agentId,
      // Still passed: an archived goal's status submenu stays locked until restored.
      archivedAt,
      creatorUserId,
      goalId,
      // The archive action has its own header button.
      omitArchive: true,
      onRename,
      projectId,
      status,
      title,
    });

    const canArchive = !archive.deniedReason;

    return (
      <>
        {/* A blocked archive stays enabled so hover and keyboard users can read why;
            a click only repeats the reason. Never mark it `aria-disabled`: ActionIcon
            styles that with `pointer-events: none`, which hides the reason. */}
        <ActionIcon
          aria-description={archive.deniedReason}
          aria-label={archive.label}
          color={canArchive ? undefined : cssVar.colorTextDisabled}
          icon={archive.isArchived ? ArchiveRestoreIcon : ArchiveIcon}
          size={DESKTOP_HEADER_ICON_SMALL_SIZE}
          style={canArchive ? undefined : { cursor: 'not-allowed' }}
          title={archive.deniedReason ?? archive.label}
          tooltipProps={{ placement: 'bottom' }}
          onClick={() => void archive.toggle()}
        />
        <DropdownMenu items={items} placement={'bottomRight'}>
          <ActionIcon
            icon={MoreHorizontalIcon}
            size={'small'}
            title={t('goalDetail.moreActions')}
          />
        </DropdownMenu>
      </>
    );
  },
);

GoalDetailActions.displayName = 'GoalDetailActions';

export default GoalDetailActions;

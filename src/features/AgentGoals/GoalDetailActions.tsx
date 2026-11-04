import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { goalSelectors, useGoalStore } from '@/store/goal';

import { isGoalSnapshotSignedOff } from './goalSignedOff';
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

const GoalDetailActions = memo<GoalDetailActionsProps>(
  ({ agentId, archivedAt, goalId, onRename, projectId }) => {
    const { t } = useTranslation('chat');
    const status = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.status);
    const creatorUserId = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.userId);
    const title = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.title);
    const signedOff = useGoalStore((s) =>
      isGoalSnapshotSignedOff(goalSelectors.goalGraph(goalId)(s)),
    );
    const items = useGoalMenuItems({
      agentId,
      archivedAt,
      creatorUserId,
      goalId,
      onRename,
      projectId,
      signedOff,
      status,
      title,
    });

    return (
      <DropdownMenu items={items} placement={'bottomRight'}>
        <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('goalDetail.moreActions')} />
      </DropdownMenu>
    );
  },
);

GoalDetailActions.displayName = 'GoalDetailActions';

export default GoalDetailActions;

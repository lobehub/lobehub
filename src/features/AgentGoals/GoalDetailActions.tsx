import { ActionIcon, DropdownMenu } from '@lobehub/ui';
import { MoreHorizontalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { goalSelectors, useGoalStore } from '@/store/goal';

import { useGoalMenuItems } from './useGoalMenuItems';

interface GoalDetailActionsProps {
  /** Absent for a goal with no responsible agent — e.g. one created from a project. */
  agentId?: string;
  goalId: string;
  /** Moves to the in-place title editor instead of opening the rename dialog. */
  onRename?: () => void;
  projectId?: string | null;
}

const GoalDetailActions = memo<GoalDetailActionsProps>(
  ({ agentId, goalId, onRename, projectId }) => {
    const { t } = useTranslation('chat');
    const status = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.status);
    const creatorUserId = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.userId);
    const title = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.title);
    const items = useGoalMenuItems({
      agentId,
      creatorUserId,
      goalId,
      onRename,
      projectId,
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

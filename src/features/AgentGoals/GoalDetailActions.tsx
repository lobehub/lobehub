import { copyToClipboard, Icon } from '@lobehub/ui';
import {
  ActionIcon,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  toast,
} from '@lobehub/ui';
import { CircleDashedIcon, CopyIcon, LinkIcon, MoreHorizontalIcon, TrashIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { TASK_STATUS_VISUALS } from '@/components/ExecutionStatus';
import { renderMenuCheck } from '@/features/AgentTasks/features/menuExtra';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { goalSelectors, useGoalStore } from '@/store/goal';

import { goalStatusToTaskStatus } from './goalPresentation';
import {
  isStatusChoiceDisabled,
  MANUAL_STATUSES,
  type ManualGoalStatus,
  toManualStatus,
} from './goalStatusMenu';
import { useConfirmDeleteGoal, useGoalShareUrl } from './useGoalActions';

interface GoalDetailActionsProps {
  /** Absent for a goal with no responsible agent — e.g. one created from a project. */
  agentId?: string;
  goalId: string;
  projectId?: string | null;
}

const GoalDetailActions = memo<GoalDetailActionsProps>(({ agentId, goalId, projectId }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { allowed: canEditTask } = usePermission('create_content');
  const shareUrl = useGoalShareUrl({ agentId, goalId });
  const confirmDelete = useConfirmDeleteGoal({ agentId, goalId, projectId });
  const status = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.status);
  const creatorUserId = useGoalStore((s) => goalSelectors.goalGraph(goalId)(s)?.goal.userId);
  // Closing interrupts runs, so the server only lets the creator or a
  // workspace owner do it — the same rule as restart.
  const canClose = useResourceManageable(creatorUserId);
  const pauseGoal = useGoalStore((s) => s.pauseGoal);
  const resumeGoal = useGoalStore((s) => s.resumeGoal);
  const closeGoal = useGoalStore((s) => s.closeGoal);

  const current = toManualStatus(status);

  const changeStatus = useCallback(
    (next: ManualGoalStatus) => {
      if (next === current) return;
      if (next === 'running') return void resumeGoal(goalId);
      if (next === 'paused') return void pauseGoal(goalId);
      // Closing interrupts live runs, so it asks first.
      confirmModal({
        cancelText: t('cancel', { ns: 'common' }),
        content: t(`goalDetail.closeConfirm.${next}.content`),
        okButtonProps: { danger: next === 'canceled' },
        okText: t(`goalDetail.closeConfirm.${next}.ok`),
        onOk: () => closeGoal(goalId, next),
        title: t(`goalDetail.closeConfirm.${next}.title`),
      });
    },
    [closeGoal, current, goalId, pauseGoal, resumeGoal, t],
  );

  const items = useMemo<DropdownItem[]>(
    () => [
      // Same shape as a task's status submenu: status-colored glyphs, a check on the current one.
      {
        children: MANUAL_STATUSES.map((next) => {
          const visual = TASK_STATUS_VISUALS[goalStatusToTaskStatus(next)];
          return {
            disabled: isStatusChoiceDisabled(next, status, canClose),
            extra: renderMenuCheck(next === current),
            icon: <Icon color={visual.color} icon={visual.icon} />,
            key: `status-${next}`,
            label: t(`goalList.status.${next}`),
            onClick: () => changeStatus(next),
          };
        }),
        disabled: !canEditTask || !status,
        icon: <Icon icon={CircleDashedIcon} />,
        key: 'status',
        label: t('taskList.contextMenu.status'),
      },
      { type: 'divider' },
      {
        icon: <Icon icon={CopyIcon} />,
        key: 'copyId',
        label: t('taskList.contextMenu.copyId'),
        onClick: async () => {
          await copyToClipboard(goalId);
          toast.success(t('taskList.contextMenu.copyIdSuccess'));
        },
      },
      {
        disabled: !shareUrl,
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async () => {
          if (!shareUrl) return;
          await copyToClipboard(shareUrl);
          toast.success(t('taskList.contextMenu.copyLinkSuccess'));
        },
      },
      { type: 'divider' },
      {
        danger: true,
        disabled: !canEditTask,
        icon: <Icon icon={TrashIcon} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: confirmDelete,
      },
    ],
    [canClose, canEditTask, changeStatus, confirmDelete, current, goalId, shareUrl, status, t],
  );

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('goalDetail.moreActions')} />
    </DropdownMenu>
  );
});

GoalDetailActions.displayName = 'GoalDetailActions';

export default GoalDetailActions;

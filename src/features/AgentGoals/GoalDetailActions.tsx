import { copyToClipboard, Icon } from '@lobehub/ui';
import { ActionIcon, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { CopyIcon, LinkIcon, MoreHorizontalIcon, TrashIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

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

  const items = useMemo<DropdownItem[]>(
    () => [
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
    [canEditTask, confirmDelete, goalId, shareUrl, t],
  );

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('goalDetail.moreActions')} />
    </DropdownMenu>
  );
});

GoalDetailActions.displayName = 'GoalDetailActions';

export default GoalDetailActions;

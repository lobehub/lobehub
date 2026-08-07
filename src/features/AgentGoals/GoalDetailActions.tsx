import { ActionIcon, copyToClipboard, Icon } from '@lobehub/ui';
import { confirmModal, type DropdownItem, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { CopyIcon, LinkIcon, MoreHorizontalIcon, TrashIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useGoalStore } from '@/store/goal';

interface GoalDetailActionsProps {
  agentId: string;
  goalId: string;
}

const GoalDetailActions = memo<GoalDetailActionsProps>(({ agentId, goalId }) => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canEditTask } = usePermission('create_content');
  const deleteGoal = useGoalStore((s) => s.deleteGoal);

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
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async () => {
          await copyToClipboard(window.location.href);
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
        onClick: () => {
          confirmModal({
            content: t('goalDetail.deleteConfirm.content'),
            okButtonProps: { danger: true },
            okText: t('goalDetail.deleteConfirm.ok'),
            onOk: async () => {
              await deleteGoal(agentId, goalId);
              navigate(`/agent/${agentId}/goals`);
            },
            title: t('goalDetail.deleteConfirm.title'),
          });
        },
      },
    ],
    [agentId, canEditTask, deleteGoal, goalId, navigate, t],
  );

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('goalDetail.moreActions')} />
    </DropdownMenu>
  );
});

GoalDetailActions.displayName = 'GoalDetailActions';

export default GoalDetailActions;

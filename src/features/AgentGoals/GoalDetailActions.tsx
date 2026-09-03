import { copyToClipboard, Icon } from '@lobehub/ui';
import {
  ActionIcon,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  toast,
} from '@lobehub/ui/base-ui';
import { CopyIcon, LinkIcon, MoreHorizontalIcon, TrashIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { useGoalStore } from '@/store/goal';

interface GoalDetailActionsProps {
  /** Absent for a goal with no responsible agent — e.g. one created from a project. */
  agentId?: string;
  goalId: string;
  projectId?: string | null;
}

const GoalDetailActions = memo<GoalDetailActionsProps>(({ agentId, goalId, projectId }) => {
  const { t } = useTranslation(['chat', 'common']);
  const navigate = useWorkspaceAwareNavigate();
  const { allowed: canEditTask } = usePermission('create_content');
  const deleteGoal = useGoalStore((s) => s.deleteGoal);
  // Not `window.location.href`: on desktop that is the `app://renderer` shell
  // origin (and the shell location does not track the active tab) — build the
  // shareable web URL from the app origin and the goal route explicitly.
  const appOrigin = useAppOrigin();
  const shareUrl = appOrigin
    ? `${appOrigin}${agentId ? `/agent/${agentId}/goal/${goalId}` : `/goal/${goalId}`}`
    : undefined;

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
        onClick: () => {
          confirmModal({
            content: t('goalDetail.deleteConfirm.content'),
            okButtonProps: { danger: true },
            okText: t('goalDetail.deleteConfirm.ok'),
            onOk: async () => {
              // Mirrors the list scope the goal was rendered under, so the page
              // the user lands on is the one whose cache was just refreshed.
              await deleteGoal(agentId, goalId, projectId ? `project:${projectId}` : undefined);
              navigate(
                agentId
                  ? `/agent/${agentId}/goals`
                  : projectId
                    ? `/project/${projectId}/goals`
                    : '/',
              );
            },
            title: t('goalDetail.deleteConfirm.title'),
          });
        },
      },
    ],
    [agentId, canEditTask, deleteGoal, goalId, navigate, projectId, shareUrl, t],
  );

  return (
    <DropdownMenu items={items} placement={'bottomRight'}>
      <ActionIcon icon={MoreHorizontalIcon} size={'small'} title={t('goalDetail.moreActions')} />
    </DropdownMenu>
  );
});

GoalDetailActions.displayName = 'GoalDetailActions';

export default GoalDetailActions;

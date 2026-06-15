import { ActionIcon, copyToClipboard, type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { CopyIcon, LinkIcon, MoreHorizontal, Trash } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useTaskTransferMenuItem } from '@/business/client/hooks/useTaskTransferMenuItem';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';

import { taskDetailPath } from '../shared/taskDetailPath';

const TaskDetailHeaderActions = memo(() => {
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { allowed: canEditTask } = usePermission('create_content');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskAgentId = useTaskStore(taskDetailSelectors.activeTaskAgentId);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const transferItems = useTaskTransferMenuItem(taskId) as DropdownItem[] | null;

  const triggerDelete = useCallback(() => {
    if (!canEditTask) return;
    if (!taskId) return;
    confirmModal({
      content: t('taskDetail.deleteConfirm.content'),
      okButtonProps: { danger: true },
      okText: t('taskDetail.deleteConfirm.ok'),
      onOk: async () => {
        await deleteTask(taskId);
        navigate('/tasks');
      },
      title: t('taskDetail.deleteConfirm.title'),
    });
  }, [canEditTask, taskId, t, deleteTask, navigate]);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!taskId) return [];

    const taskUrl = `${appOrigin}${buildWorkspaceAwarePath(
      taskDetailPath(taskId, taskAgentId ?? undefined),
      activeWorkspaceSlug,
    )}`;

    const baseItems: DropdownItem[] = [
      {
        icon: <Icon icon={CopyIcon} />,
        key: 'copyId',
        label: t('taskList.contextMenu.copyId'),
        onClick: async () => {
          await copyToClipboard(taskId);
          message.success(t('taskList.contextMenu.copyIdSuccess'));
        },
      },
      {
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async () => {
          await copyToClipboard(taskUrl);
          message.success(t('taskList.contextMenu.copyLinkSuccess'));
        },
      },
      { type: 'divider' },
      {
        danger: true,
        disabled: !canEditTask,
        icon: <Icon icon={Trash} />,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: triggerDelete,
      },
    ];

    if (!transferItems || transferItems.length === 0) return baseItems;

    return [...baseItems.slice(0, 3), ...transferItems, { type: 'divider' }, ...baseItems.slice(3)];
  }, [
    taskId,
    taskAgentId,
    appOrigin,
    activeWorkspaceSlug,
    t,
    message,
    triggerDelete,
    canEditTask,
    transferItems,
  ]);

  if (!taskId) return null;

  return (
    <DropdownMenu items={menuItems}>
      <ActionIcon icon={MoreHorizontal} size={'small'} />
    </DropdownMenu>
  );
});

export default TaskDetailHeaderActions;

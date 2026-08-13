import { ActionIcon, copyToClipboard, type DropdownItem, DropdownMenu, Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { CopyIcon, EyeOffIcon, LinkIcon, MoreHorizontal, Trash, UsersIcon } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useTaskTransferMenuItem } from '@/business/client/hooks/useTaskTransferMenuItem';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { buildWorkspaceAwarePath } from '@/features/Workspace/workspaceAwarePath';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { usePermission } from '@/hooks/usePermission';
import { taskDetailProjectionSelectors } from '@/projection/modules/task/derivedSelectors';
import { useActiveTaskDetailProjection, useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { taskDetailPath } from '../shared/taskDetailPath';

const TaskDetailHeaderActions = memo(() => {
  const { t } = useTranslation(['chat', 'common']);

  const navigate = useWorkspaceAwareNavigate();
  const appOrigin = useAppOrigin();
  const activeWorkspaceId = useActiveWorkspaceId();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();
  const { allowed: canEditTask } = usePermission('create_content');
  const taskId = useTaskStore(taskDetailSelectors.activeTaskId);
  const taskAgentId = useActiveTaskDetailProjection(
    taskDetailProjectionSelectors.activeTaskAgentId,
  );
  const visibility = useActiveTaskDetailProjection(
    taskDetailProjectionSelectors.activeTaskVisibility,
  );
  const createdByUserId = useActiveTaskDetailProjection(
    taskDetailProjectionSelectors.activeTaskCreatedByUserId,
  );
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const updateTaskVisibility = useTaskStore((s) => s.updateTaskVisibility);
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

  const triggerPublish = useCallback(() => {
    if (!canEditTask) return;
    if (!taskId) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: (
        <>
          <VisibilityConfirmContent variant="publish" />
          <div style={{ marginTop: 8, opacity: 0.7 }}>
            {t('taskDetail.publishToWorkspace.confirmHint')}
          </div>
        </>
      ),
      okText: t('taskDetail.publishToWorkspace.confirmOk'),
      onOk: async () => {
        try {
          await updateTaskVisibility(taskId, 'public');
        } catch {
          // store action already surfaced a targeted toast; swallow so the
          // confirm modal doesn't bubble a second error to base-ui.
        }
      },
      title: t('taskDetail.publishToWorkspace.confirmTitle'),
    });
  }, [canEditTask, taskId, t, updateTaskVisibility]);

  const triggerMakePrivate = useCallback(() => {
    if (!canEditTask) return;
    if (!taskId) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="makePrivate" />,
      okButtonProps: { danger: true },
      okText: t('makePrivate.confirm.ok', { ns: 'common' }),
      onOk: async () => {
        try {
          await updateTaskVisibility(taskId, 'private');
          toast.success(t('makePrivate.success', { ns: 'common' }));
        } catch {
          // store action already surfaced a targeted toast; swallow so the
          // confirm modal doesn't bubble a second error to base-ui.
        }
      },
      title: t('makePrivate.confirm.title', { ns: 'common' }),
    });
  }, [canEditTask, taskId, t, updateTaskVisibility]);

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
          toast.success(t('taskList.contextMenu.copyIdSuccess'));
        },
      },
      {
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: async () => {
          await copyToClipboard(taskUrl);
          toast.success(t('taskList.contextMenu.copyLinkSuccess'));
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

    // Publish-to-workspace only surfaces on private tasks inside a workspace;
    // personal mode has no workspace to publish to.
    const publishItem: DropdownItem | null =
      activeWorkspaceId && visibility === 'private'
        ? {
            disabled: !canEditTask,
            icon: <Icon icon={UsersIcon} />,
            key: 'publishToWorkspace',
            label: t('taskDetail.publishToWorkspace.menuLabel'),
            onClick: triggerPublish,
          }
        : null;

    // Inverse transition: only the task creator can pull a
    // published task back to private ( — an owner demoting another
    // member's task would appropriate it into the creator's private list);
    // everyone else doesn't see the entry at all (the server enforces the
    // same rule as a backstop).
    const canMakePrivate = !!currentUserId && createdByUserId === currentUserId;
    const makePrivateItem: DropdownItem | null =
      activeWorkspaceId && visibility === 'public' && canMakePrivate
        ? {
            disabled: !canEditTask,
            icon: <Icon icon={EyeOffIcon} />,
            key: 'makePrivate',
            label: t('makePrivate', { ns: 'common' }),
            onClick: triggerMakePrivate,
          }
        : null;

    const visibilityItem = publishItem ?? makePrivateItem;

    const transferGroup =
      transferItems && transferItems.length > 0
        ? [...transferItems, ...(visibilityItem ? [visibilityItem] : [])]
        : visibilityItem
          ? [visibilityItem]
          : [];

    if (transferGroup.length === 0) return baseItems;

    return [...baseItems.slice(0, 3), ...transferGroup, { type: 'divider' }, ...baseItems.slice(3)];
  }, [
    taskId,
    taskAgentId,
    appOrigin,
    activeWorkspaceSlug,
    activeWorkspaceId,
    visibility,
    createdByUserId,
    currentUserId,
    t,
    triggerDelete,
    triggerPublish,
    triggerMakePrivate,
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

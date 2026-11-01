import {
  ActionIcon,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  Icon,
  toast,
} from '@lobehub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CopyIcon,
  EyeOffIcon,
  FileTextIcon,
  LinkIcon,
  MoreHorizontal,
  Trash,
  UsersIcon,
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useTaskTransferMenuItem } from '@/business/client/hooks/useTaskTransferMenuItem';
import { FavoriteButton, useFavoriteMenuItem } from '@/features/Favorites';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useTaskStore } from '@/store/task';
import { taskDetailSelectors } from '@/store/task/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

import { getArchiveErrorKey } from '../features/archiveErrorKey';
import { useTaskArchiveGate } from '../features/useTaskArchiveGate';
import { useTaskCopyActions } from './useTaskCopyActions';
import { useTaskFavoriteTarget } from './useTaskFavoriteTarget';

const TaskDetailHeaderActions = memo(() => {
  const { t } = useTranslation(['chat', 'common']);

  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceId = useActiveWorkspaceId();
  const { allowed: canEditTask } = usePermission('create_content');
  const { copyContent, copyId, copyLink, hasContent, taskId } = useTaskCopyActions();
  const visibility = useTaskStore(taskDetailSelectors.activeTaskVisibility);
  const createdByUserId = useTaskStore(taskDetailSelectors.activeTaskCreatedByUserId);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const archiveTask = useTaskStore((s) => s.archiveTask);
  const isArchived = !!useTaskStore(taskDetailSelectors.activeTaskArchivedAt);
  const isArchiveBlocked = useTaskStore(taskDetailSelectors.isActiveTaskArchiveBlocked);
  const checkArchive = useTaskArchiveGate();
  const { allowed: canArchive, reasonKey: archiveDeniedKey } = checkArchive({
    archiveBlocked: !isArchived && isArchiveBlocked,
  });
  const updateTaskVisibility = useTaskStore((s) => s.updateTaskVisibility);
  const transferItems = useTaskTransferMenuItem(taskId) as DropdownItem[] | null;
  const favoriteTarget = useTaskFavoriteTarget();
  const favoriteMenuItem = useFavoriteMenuItem(favoriteTarget);

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

  const toggleArchive = useCallback(async () => {
    if (!canArchive || !taskId) return;
    try {
      await archiveTask(taskId, !isArchived);
    } catch (error) {
      toast.error(t(getArchiveErrorKey(error)));
      return;
    }
    toast.success(
      t(
        isArchived
          ? 'taskList.contextMenu.unarchiveSuccess'
          : 'taskList.contextMenu.archiveSuccess',
      ),
    );
  }, [archiveTask, canArchive, isArchived, t, taskId]);

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

  // Someone else's public task can only go private as the caller's own: it is
  // taken over, which the confirmation spells out.
  const takesOver = !!currentUserId && !!createdByUserId && createdByUserId !== currentUserId;

  const triggerMakePrivate = useCallback(() => {
    if (!canEditTask) return;
    if (!taskId) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: (
        <>
          <VisibilityConfirmContent variant="makePrivate" />
          {takesOver && (
            <div style={{ marginTop: 8, opacity: 0.7 }}>{t('taskDetail.takeOver.confirmHint')}</div>
          )}
        </>
      ),
      okButtonProps: { danger: true },
      okText: takesOver
        ? t('taskDetail.takeOver.confirmOk')
        : t('makePrivate.confirm.ok', { ns: 'common' }),
      onOk: async () => {
        try {
          await (takesOver
            ? updateTaskVisibility(taskId, 'private', { takeOwnership: true })
            : updateTaskVisibility(taskId, 'private'));
          toast.success(
            takesOver
              ? t('taskDetail.takeOver.success')
              : t('makePrivate.success', { ns: 'common' }),
          );
        } catch {
          // store action already surfaced a targeted toast; swallow so the
          // confirm modal doesn't bubble a second error to base-ui.
        }
      },
      title: takesOver
        ? t('taskDetail.takeOver.confirmTitle')
        : t('makePrivate.confirm.title', { ns: 'common' }),
    });
  }, [canEditTask, taskId, t, takesOver, updateTaskVisibility]);

  const menuItems = useMemo<DropdownItem[]>(() => {
    if (!taskId) return [];

    const baseItems: DropdownItem[] = [
      {
        icon: <Icon icon={CopyIcon} />,
        key: 'copyId',
        label: t('taskList.contextMenu.copyId'),
        onClick: copyId,
      },
      {
        icon: <Icon icon={LinkIcon} />,
        key: 'copyLink',
        label: t('taskList.contextMenu.copyLink'),
        onClick: copyLink,
      },
      {
        disabled: !hasContent,
        icon: <Icon icon={FileTextIcon} />,
        key: 'copyContent',
        label: t('taskList.contextMenu.copyContent'),
        onClick: copyContent,
      },
      { type: 'divider' },
      ...(favoriteMenuItem ? [favoriteMenuItem, { type: 'divider' as const }] : []),
      {
        desc: archiveDeniedKey && t(archiveDeniedKey),
        disabled: !canArchive,
        icon: <Icon icon={isArchived ? ArchiveRestoreIcon : ArchiveIcon} />,
        key: 'archive',
        label: t(isArchived ? 'taskList.contextMenu.unarchive' : 'taskList.contextMenu.archive'),
        onClick: toggleArchive,
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

    // Inverse transition: the creator pulls a published task back to private;
    // any other member takes it over as their own private task.
    const makePrivateItem: DropdownItem | null =
      activeWorkspaceId && visibility === 'public' && !!currentUserId
        ? {
            disabled: !canEditTask,
            icon: <Icon icon={EyeOffIcon} />,
            key: 'makePrivate',
            label: takesOver
              ? t('taskDetail.takeOver.menuLabel')
              : t('makePrivate', { ns: 'common' }),
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

    // Slot the transfer group right after the copy group's divider.
    const copyGroupEnd = baseItems.findIndex((item) => item?.type === 'divider') + 1;

    return [
      ...baseItems.slice(0, copyGroupEnd),
      ...transferGroup,
      { type: 'divider' },
      ...baseItems.slice(copyGroupEnd),
    ];
  }, [
    taskId,
    favoriteMenuItem,
    copyId,
    copyLink,
    copyContent,
    hasContent,
    activeWorkspaceId,
    visibility,
    currentUserId,
    takesOver,
    t,
    triggerDelete,
    toggleArchive,
    isArchived,
    archiveDeniedKey,
    canArchive,
    triggerPublish,
    triggerMakePrivate,
    canEditTask,
    transferItems,
  ]);

  if (!taskId) return null;

  return (
    <>
      {favoriteTarget && <FavoriteButton {...favoriteTarget} />}
      <DropdownMenu items={menuItems}>
        <ActionIcon icon={MoreHorizontal} size={'small'} />
      </DropdownMenu>
    </>
  );
});

export default TaskDetailHeaderActions;

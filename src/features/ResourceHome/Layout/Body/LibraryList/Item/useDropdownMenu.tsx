import { type MenuProps } from '@lobehub/ui';
import { Icon, Tooltip } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { EyeOffIcon, FileText, GlobeIcon, PencilLine, Trash, UsersIcon } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useKnowledgeBaseTransferMenuItem } from '@/business/client/hooks/useKnowledgeBaseTransferMenuItem';
import { useCreateNewModal } from '@/features/LibraryModal';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useKnowledgeBaseStore } from '@/store/library';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';
import { isForbiddenError } from '@/utils/forbiddenError';

interface ActionProps {
  description?: string | null;
  id: string;
  name: string;
  /** Server-computed on the list payload: creator or KNOWLEDGE_BASE_UPDATE:all. */
  permissionManageable?: boolean;
  toggleEditing: (visible?: boolean) => void;
  userId?: string;
  visibility?: 'private' | 'public';
}

export const useDropdownMenu = ({
  id,
  name,
  description,
  permissionManageable,
  toggleEditing,
  userId,
  visibility,
}: ActionProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['file', 'common', 'chat', 'setting']);

  const removeKnowledgeBase = useKnowledgeBaseStore((s) => s.removeKnowledgeBase);
  const publishKnowledgeBaseToWorkspace = useKnowledgeBaseStore(
    (s) => s.publishKnowledgeBaseToWorkspace,
  );
  const setKnowledgeBaseVisibility = useKnowledgeBaseStore((s) => s.setKnowledgeBaseVisibility);
  const { open } = useCreateNewModal();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const transferMenuItems = useKnowledgeBaseTransferMenuItem(id);
  const currentUserId = useUserStore(userProfileSelectors.userId);
  // Only the creator of a still-private KB sees the "Publish to workspace" entry.
  // Mirrors the file / agent / task one-way publish pattern.
  const isOwnPrivateKb =
    visibility === 'private' && !!currentUserId && !!userId && userId === currentUserId;
  // Bidirectional counterpart: workspace-public KBs owned by the caller can be
  // pulled back to private via the same guarded server path.
  const isOwnPublicKb =
    visibility === 'public' && !!currentUserId && !!userId && userId === currentUserId;

  // Member Permissions entry: navigates to the standalone permission page,
  // same as Agent. Private KBs are included — the creator configures what
  // members get the moment the KB is published. The manage flag rides the
  // list payload (creator or `KNOWLEDGE_BASE_UPDATE:all` curators), so no
  // per-row permission request is issued while rendering the sidebar.
  const activeWorkspaceId = useActiveWorkspaceId();
  const wsNavigate = useWorkspaceAwareNavigate();
  const memberPermissionMenuItem = useMemo(
    () =>
      activeWorkspaceId && permissionManageable
        ? {
            icon: <Icon icon={UsersIcon} />,
            key: 'member-permissions',
            label: t('permission.page.entry', { ns: 'setting' }),
            onClick: (info: any) => {
              info.domEvent?.stopPropagation();
              wsNavigate(`/resource/library/${id}/permission`);
            },
          }
        : null,
    [activeWorkspaceId, permissionManageable, id, t, wsNavigate],
  );

  // Row-level ownership: only the creator or a workspace owner may edit or
  // delete a shared knowledge base — mirrors the server-side enforcement.
  const canManage = useResourceManageable(userId);
  const manageTooltip = canManage ? undefined : t('manageOnlyCreator', { ns: 'common' });

  const handleDelete = useCallback(() => {
    if (!canEdit || !canManage) return;
    if (!id) return;

    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('library.list.confirmRemoveLibrary'),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        try {
          await removeKnowledgeBase(id);
        } catch (error) {
          toast.error(
            isForbiddenError(error)
              ? t('manageOnlyCreator', { ns: 'common' })
              : t('operationFailed', { ns: 'common' }),
          );
        }
      },
      title: t('header.actions.deleteLibrary'),
    });
  }, [canEdit, canManage, id, removeKnowledgeBase, t]);

  const handleEditDescription = useCallback(() => {
    if (!canEdit || !canManage) return;
    open({
      id,
      initialValues: { description: description || '', name },
    });
  }, [canEdit, canManage, description, id, name, open]);

  const handlePublish = useCallback(() => {
    if (!isOwnPrivateKb) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="publish" />,
      okText: t('continue', { ns: 'common' }),
      onOk: async () => {
        try {
          await publishKnowledgeBaseToWorkspace(id);
          toast.success(t('resources.publishToWorkspace.success', { ns: 'chat' }));
        } catch (error) {
          console.error(error);
          toast.error(t('resources.publishToWorkspace.error', { ns: 'chat' }));
        }
      },
      title: t('library.publishConfirm.title'),
    });
  }, [isOwnPrivateKb, id, publishKnowledgeBaseToWorkspace, t]);

  const handleMakePrivate = useCallback(() => {
    if (!isOwnPublicKb) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="makePrivate" />,
      okButtonProps: { danger: true },
      okText: t('continue', { ns: 'common' }),
      onOk: async () => {
        try {
          await setKnowledgeBaseVisibility(id, 'private');
          toast.success(t('makePrivate.success', { ns: 'common' }));
        } catch (error) {
          console.error(error);
          toast.error(t('makePrivate.error', { ns: 'common' }));
        }
      },
      title: t('makePrivate.confirm.title', { ns: 'common' }),
    });
  }, [isOwnPublicKb, id, setKnowledgeBaseVisibility, t]);

  return useCallback(
    () =>
      [
        {
          disabled: !canEdit || !canManage,
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: manageTooltip ? (
            <Tooltip title={manageTooltip}>
              <span>{t('rename', { ns: 'common' })}</span>
            </Tooltip>
          ) : (
            t('rename', { ns: 'common' })
          ),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            if (!canEdit || !canManage) return;
            // Defer to next frame so the DropdownMenu fully finishes its
            // close animation and event handlers before the Popover opens.
            // Otherwise the tail-end mouseup/click bubbles to document and
            // Popover's outside-click detection fires `onOpenChange(false)`
            // one tick after we set it to true, causing the input to flash
            // open and immediately snap shut.
            requestAnimationFrame(() => toggleEditing(true));
          },
        },
        {
          disabled: !canEdit || !canManage,
          icon: <Icon icon={FileText} />,
          key: 'editDescription',
          label: manageTooltip ? (
            <Tooltip title={manageTooltip}>
              <span>{t('edit', { ns: 'common' })}</span>
            </Tooltip>
          ) : (
            t('edit', { ns: 'common' })
          ),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            handleEditDescription();
          },
        },
        canEdit &&
          isOwnPrivateKb && {
            icon: <Icon icon={GlobeIcon} />,
            key: 'publishToWorkspace',
            label: t('library.publish'),
            onClick: (info: any) => {
              info.domEvent?.stopPropagation();
              handlePublish();
            },
          },
        canEdit && isOwnPrivateKb && { type: 'divider' },
        canEdit &&
          isOwnPublicKb && {
            icon: <Icon icon={EyeOffIcon} />,
            key: 'makePrivate',
            label: t('makePrivate', { ns: 'common' }),
            onClick: (info: any) => {
              info.domEvent?.stopPropagation();
              handleMakePrivate();
            },
          },
        canEdit && isOwnPublicKb && { type: 'divider' },
        memberPermissionMenuItem,
        memberPermissionMenuItem && { type: 'divider' },
        ...(canEdit ? (transferMenuItems ?? []) : []),
        { type: 'divider' },
        {
          danger: true,
          disabled: !canEdit || !canManage,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: manageTooltip ? (
            <Tooltip title={manageTooltip}>
              <span>{t('delete', { ns: 'common' })}</span>
            </Tooltip>
          ) : (
            t('delete', { ns: 'common' })
          ),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [
      canEdit,
      canManage,
      manageTooltip,
      t,
      toggleEditing,
      handleDelete,
      handleEditDescription,
      handlePublish,
      handleMakePrivate,
      isOwnPrivateKb,
      isOwnPublicKb,
      memberPermissionMenuItem,
      transferMenuItems,
    ],
  );
};

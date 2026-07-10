import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { EyeOffIcon, FileText, GlobeIcon, PencilLine, Trash } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useKnowledgeBaseTransferMenuItem } from '@/business/client/hooks/useKnowledgeBaseTransferMenuItem';
import { useCreateNewModal } from '@/features/LibraryModal';
import VisibilityConfirmContent from '@/features/VisibilityConfirmContent';
import { usePermission } from '@/hooks/usePermission';
import { useKnowledgeBaseStore } from '@/store/library';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

interface ActionProps {
  description?: string | null;
  id: string;
  name: string;
  toggleEditing: (visible?: boolean) => void;
  userId?: string;
  visibility?: 'private' | 'public';
}

export const useDropdownMenu = ({
  id,
  name,
  description,
  toggleEditing,
  userId,
  visibility,
}: ActionProps): (() => MenuProps['items']) => {
  const { t } = useTranslation(['file', 'common', 'chat']);
  const { message } = App.useApp();
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

  const handleDelete = useCallback(() => {
    if (!canEdit) return;
    if (!id) return;

    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('library.list.confirmRemoveLibrary'),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        await removeKnowledgeBase(id);
      },
      title: t('header.actions.deleteLibrary'),
    });
  }, [canEdit, id, removeKnowledgeBase, t]);

  const handleEditDescription = useCallback(() => {
    if (!canEdit) return;
    open({
      id,
      initialValues: { description: description || '', name },
    });
  }, [canEdit, description, id, name, open]);

  const handlePublish = useCallback(() => {
    if (!isOwnPrivateKb) return;
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: <VisibilityConfirmContent variant="publish" />,
      okText: t('continue', { ns: 'common' }),
      onOk: async () => {
        try {
          await publishKnowledgeBaseToWorkspace(id);
          message.success(t('resources.publishToWorkspace.success', { ns: 'chat' }));
        } catch (error) {
          console.error(error);
          message.error(t('resources.publishToWorkspace.error', { ns: 'chat' }));
        }
      },
      title: t('library.publishConfirm.title'),
    });
  }, [isOwnPrivateKb, id, publishKnowledgeBaseToWorkspace, t, message]);

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
          message.success(t('makePrivate.success', { ns: 'common' }));
        } catch (error) {
          console.error(error);
          message.error(t('makePrivate.error', { ns: 'common' }));
        }
      },
      title: t('makePrivate.confirm.title', { ns: 'common' }),
    });
  }, [isOwnPublicKb, id, setKnowledgeBaseVisibility, t, message]);

  return useCallback(
    () =>
      [
        {
          disabled: !canEdit,
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
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
          disabled: !canEdit,
          icon: <Icon icon={FileText} />,
          key: 'editDescription',
          label: t('edit', { ns: 'common' }),
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
        ...(canEdit ? (transferMenuItems ?? []) : []),
        { type: 'divider' },
        {
          danger: true,
          disabled: !canEdit,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: handleDelete,
        },
      ].filter(Boolean) as MenuProps['items'],
    [
      canEdit,
      t,
      toggleEditing,
      handleDelete,
      handleEditDescription,
      handlePublish,
      handleMakePrivate,
      isOwnPrivateKb,
      isOwnPublicKb,
      transferMenuItems,
    ],
  );
};

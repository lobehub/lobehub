import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { LucideCopy, Pen, PictureInPicture2Icon, Pin, PinOff, Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupTransferMenuItem } from '@/business/client/hooks/useAgentGroupTransferMenuItem';
import { openEditingPopover } from '@/features/EditingPopover/store';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { isForbiddenError, isOwnerOnlyForbiddenError } from '@/utils/forbiddenError';

interface UseGroupDropdownMenuParams {
  anchor: HTMLElement | null;
  avatar?: string;
  backgroundColor?: string;
  description?: string | null;
  id: string;
  memberAvatars?: { avatar?: string; background?: string }[];
  pinned: boolean;
  title: string;
  userId?: string | null;
}

export const useGroupDropdownMenu = ({
  anchor,
  avatar,
  backgroundColor,
  description,
  id,
  memberAvatars,
  pinned,
  title,
  userId,
}: UseGroupDropdownMenuParams): (() => MenuProps['items']) => {
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();
  const { allowed: canEdit } = usePermission('edit_own_content');
  const { canEditResource, isAccessResolved } = useResourceAccess('agentGroup', id);
  const canConfigure = canEdit && isAccessResolved && canEditResource;
  const canManage = useResourceManageable(userId);

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);
  const [pinAgentGroup, duplicateAgentGroup, removeAgentGroup] = useHomeStore((s) => [
    s.pinAgentGroup,
    s.duplicateAgentGroup,
    s.removeAgentGroup,
  ]);
  const transferMenuItems = useAgentGroupTransferMenuItem(id, {
    avatar,
    backgroundColor,
    description,
    memberAvatars,
    title,
  });

  return useMemo(
    () => () =>
      [
        ...(canConfigure
          ? [
              {
                icon: <Icon icon={pinned ? PinOff : Pin} />,
                key: 'pin',
                label: t(pinned ? 'pinOff' : 'pin'),
                onClick: () => pinAgentGroup(id, !pinned),
              },
              {
                icon: <Icon icon={Pen} />,
                key: 'rename',
                label: t('rename', { ns: 'common' }),
                onClick: (info: any) => {
                  info.domEvent?.stopPropagation();
                  if (anchor) {
                    openEditingPopover({
                      anchor,
                      avatar,
                      backgroundColor,
                      id,
                      memberAvatars,
                      title,
                      type: 'agentGroup',
                    });
                  }
                },
              },
              {
                icon: <Icon icon={LucideCopy} />,
                key: 'duplicate',
                label: t('duplicate', { ns: 'common' }),
                onClick: ({ domEvent }: any) => {
                  domEvent.stopPropagation();
                  duplicateAgentGroup(id);
                },
              },
            ]
          : []),
        {
          icon: <Icon icon={PictureInPicture2Icon} />,
          key: 'openInNewWindow',
          label: t('openInNewWindow'),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            openAgentInNewWindow(id);
          },
        },
        ...(canConfigure && transferMenuItems?.length
          ? [{ type: 'divider' as const }, ...transferMenuItems]
          : []),
        ...(canConfigure && canManage
          ? [
              { type: 'divider' as const },
              {
                danger: true,
                icon: <Icon icon={Trash} />,
                key: 'delete',
                label: t('delete', { ns: 'common' }),
                onClick: ({ domEvent }: any) => {
                  domEvent.stopPropagation();
                  confirmModal({
                    cancelText: t('cancel', { ns: 'common' }),
                    content: t('confirmRemoveChatGroupItemAlert'),
                    okButtonProps: { danger: true },
                    okText: t('delete', { ns: 'common' }),
                    onOk: async () => {
                      try {
                        await removeAgentGroup(id);
                        message.success(t('confirmRemoveGroupSuccess'));
                      } catch (error) {
                        message.error(
                          isOwnerOnlyForbiddenError(error)
                            ? t('deleteSharedOwnerOnly', { ns: 'common' })
                            : isForbiddenError(error)
                              ? t('manageOnlyCreator', { ns: 'common' })
                              : t('operationFailed', { ns: 'common' }),
                        );
                      }
                    },
                    title: t('delete', { ns: 'common' }),
                  });
                },
              },
            ]
          : []),
      ] as MenuProps['items'],
    [
      anchor,
      avatar,
      backgroundColor,
      canConfigure,
      canManage,
      memberAvatars,
      t,
      pinned,
      pinAgentGroup,
      id,
      title,
      duplicateAgentGroup,
      openAgentInNewWindow,
      removeAgentGroup,
      message,
      transferMenuItems,
    ],
  );
};

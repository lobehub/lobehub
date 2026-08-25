import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { LucideCopy, Pen, PictureInPicture2Icon, Pin, PinOff, Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentGroupTransferMenuItem } from '@/business/client/hooks/useAgentGroupTransferMenuItem';
import { useAgentGroupTransferToMemberMenuItem } from '@/business/client/hooks/useAgentGroupTransferToMemberMenuItem';
import { openEditingPopover } from '@/features/EditingPopover/store';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { getDeleteErrorMessageKey } from '@/utils/forbiddenError';

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
  const transferToMemberItem = useAgentGroupTransferToMemberMenuItem(id, {
    avatar,
    backgroundColor,
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
                sfSymbol: pinned ? 'pin.slash' : 'pin',
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
                sfSymbol: 'pencil',
              },
              {
                icon: <Icon icon={LucideCopy} />,
                key: 'duplicate',
                label: t('duplicate', { ns: 'common' }),
                onClick: ({ domEvent }: any) => {
                  domEvent.stopPropagation();
                  duplicateAgentGroup(id);
                },
                sfSymbol: 'doc.on.doc',
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
          sfSymbol: 'macwindow.badge.plus',
        },
        ...(canConfigure && (transferMenuItems?.length || transferToMemberItem)
          ? [
              { type: 'divider' as const },
              ...(transferMenuItems ?? []),
              ...(transferToMemberItem ? [transferToMemberItem] : []),
            ]
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
                        toast.success(t('confirmRemoveGroupSuccess'));
                      } catch (error) {
                        toast.error(t(getDeleteErrorMessageKey(error), { ns: 'common' }));
                      }
                    },
                    title: t('delete', { ns: 'common' }),
                  });
                },
                sfSymbol: 'trash',
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
      transferMenuItems,
      transferToMemberItem,
    ],
  );
};

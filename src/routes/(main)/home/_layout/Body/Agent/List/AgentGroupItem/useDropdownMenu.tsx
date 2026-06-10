import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { LucideCopy, Pen, PictureInPicture2Icon, Pin, PinOff, Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { openEditingPopover } from '@/features/EditingPopover/store';
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

interface UseGroupDropdownMenuParams {
  anchor: HTMLElement | null;
  avatar?: string;
  backgroundColor?: string;
  id: string;
  memberAvatars?: { avatar?: string; background?: string }[];
  pinned: boolean;
  title: string;
}

export const useGroupDropdownMenu = ({
  anchor,
  avatar,
  backgroundColor,
  id,
  memberAvatars,
  pinned,
  title,
}: UseGroupDropdownMenuParams): (() => MenuProps['items']) => {
  const { t } = useTranslation(['chat', 'common']);
  const { message } = App.useApp();
  const { allowed: canEdit } = usePermission('edit_own_content');

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);
  const [pinAgentGroup, duplicateAgentGroup, removeAgentGroup] = useHomeStore((s) => [
    s.pinAgentGroup,
    s.duplicateAgentGroup,
    s.removeAgentGroup,
  ]);

  return useMemo(
    () => () =>
      [
        {
          disabled: !canEdit,
          icon: <Icon icon={pinned ? PinOff : Pin} />,
          key: 'pin',
          label: t(pinned ? 'pinOff' : 'pin'),
          onClick: () => {
            if (!canEdit) return;

            pinAgentGroup(id, !pinned);
          },
        },
        {
          disabled: !canEdit,
          icon: <Icon icon={Pen} />,
          key: 'rename',
          label: t('rename', { ns: 'common' }),
          onClick: (info: any) => {
            info.domEvent?.stopPropagation();
            if (!canEdit) return;

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
          disabled: !canEdit,
          icon: <Icon icon={LucideCopy} />,
          key: 'duplicate',
          label: t('duplicate', { ns: 'common' }),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            if (!canEdit) return;

            duplicateAgentGroup(id);
          },
        },
        {
          icon: <Icon icon={PictureInPicture2Icon} />,
          key: 'openInNewWindow',
          label: t('openInNewWindow'),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            openAgentInNewWindow(id);
          },
        },
        { type: 'divider' },
        {
          danger: true,
          disabled: !canEdit,
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            if (!canEdit) return;

            confirmModal({
              cancelText: t('cancel', { ns: 'common' }),
              content: t('confirmRemoveChatGroupItemAlert'),
              okButtonProps: { danger: true },
              okText: t('delete', { ns: 'common' }),
              onOk: async () => {
                await removeAgentGroup(id);
                message.success(t('confirmRemoveGroupSuccess'));
              },
              title: t('delete', { ns: 'common' }),
            });
          },
        },
      ] as MenuProps['items'],
    [
      anchor,
      avatar,
      backgroundColor,
      canEdit,
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
    ],
  );
};

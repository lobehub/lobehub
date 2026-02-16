import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { LucideCopy, Pen, PictureInPicture2Icon, Pin, PinOff, Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { openEditingPopover } from '@/features/EditingPopover/store';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

interface UseGroupDropdownMenuParams {
  anchor: HTMLElement | null;
  avatar?: string;
  id: string;
  memberAvatars?: { avatar?: string; background?: string }[];
  pinned: boolean;
  title: string;
}

export const useGroupDropdownMenu = ({
  anchor,
  avatar,
  id,
  memberAvatars,
  pinned,
  title,
}: UseGroupDropdownMenuParams): (() => MenuProps['items']) => {
  const { t } = useTranslation('chat');
  const { modal, message } = App.useApp();

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
              openEditingPopover({ anchor, avatar, id, memberAvatars, title, type: 'agentGroup' });
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
          icon: <Icon icon={Trash} />,
          key: 'delete',
          label: t('delete', { ns: 'common' }),
          onClick: ({ domEvent }: any) => {
            domEvent.stopPropagation();
            modal.confirm({
              centered: true,
              okButtonProps: { danger: true },
              onOk: async () => {
                await removeAgentGroup(id);
                message.success(t('confirmRemoveGroupSuccess'));
              },
              title: t('confirmRemoveChatGroupItemAlert'),
            });
          },
        },
      ] as MenuProps['items'],
    [
      anchor,
      avatar,
      memberAvatars,
      t,
      pinned,
      pinAgentGroup,
      id,
      title,
      duplicateAgentGroup,
      openAgentInNewWindow,
      modal,
      removeAgentGroup,
      message,
    ],
  );
};

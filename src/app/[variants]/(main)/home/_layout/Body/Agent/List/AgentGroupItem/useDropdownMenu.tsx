import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { LucideCopy, Pen, PictureInPicture2Icon, Pin, PinOff, Trash } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

interface UseGroupDropdownMenuParams {
  id: string;
  pinned: boolean;
  toggleEditing: (visible?: boolean) => void;
}

export const useGroupDropdownMenu = ({
  id,
  pinned,
  toggleEditing,
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
            toggleEditing(true);
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
      t,
      pinned,
      pinAgentGroup,
      id,
      toggleEditing,
      duplicateAgentGroup,
      openAgentInNewWindow,
      modal,
      removeAgentGroup,
      message,
    ],
  );
};

import { SessionDefaultGroup } from '@lobechat/types';
import { type MenuProps } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import {
  Check,
  FolderInputIcon,
  LucideCopy,
  LucidePlus,
  Pen,
  PictureInPicture2Icon,
  Pin,
  PinOff,
  Trash,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';

interface UseAgentDropdownMenuParams {
  group: string | undefined;
  id: string;
  openCreateGroupModal: () => void;
  pinned: boolean;
  toggleEditing: (visible?: boolean) => void;
}

export const useAgentDropdownMenu = ({
  group,
  id,
  openCreateGroupModal,
  pinned,
  toggleEditing,
}: UseAgentDropdownMenuParams): (() => MenuProps['items']) => {
  const { t } = useTranslation('chat');
  const { modal, message } = App.useApp();

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);
  const sessionCustomGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
  const [pinAgent, duplicateAgent, updateAgentGroup, removeAgent] = useHomeStore((s) => [
    s.pinAgent,
    s.duplicateAgent,
    s.updateAgentGroup,
    s.removeAgent,
  ]);

  const isDefault = group === SessionDefaultGroup.Default;

  return useMemo(
    () => () =>
      [
        {
          icon: <Icon icon={pinned ? PinOff : Pin} />,
          key: 'pin',
          label: t(pinned ? 'pinOff' : 'pin'),
          onClick: () => pinAgent(id, !pinned),
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
            duplicateAgent(id);
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
          children: [
            ...sessionCustomGroups.map(({ id: groupId, name }) => ({
              icon: group === groupId ? <Icon icon={Check} /> : <div />,
              key: groupId,
              label: name,
              onClick: () => updateAgentGroup(id, groupId),
            })),
            {
              icon: isDefault ? <Icon icon={Check} /> : <div />,
              key: 'defaultList',
              label: t('defaultList'),
              onClick: () => updateAgentGroup(id, SessionDefaultGroup.Default),
            },
            { type: 'divider' as const },
            {
              icon: <Icon icon={LucidePlus} />,
              key: 'createGroup',
              label: <div>{t('sessionGroup.createGroup')}</div>,
              onClick: ({ domEvent }: any) => {
                domEvent.stopPropagation();
                openCreateGroupModal();
              },
            },
          ],
          icon: <Icon icon={FolderInputIcon} />,
          key: 'moveGroup',
          label: t('sessionGroup.moveGroup'),
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
                await removeAgent(id);
                message.success(t('confirmRemoveSessionSuccess'));
              },
              title: t('confirmRemoveSessionItemAlert'),
            });
          },
        },
      ] as MenuProps['items'],
    [
      pinned,
      id,
      toggleEditing,
      sessionCustomGroups,
      group,
      isDefault,
      openCreateGroupModal,
      message,
    ],
  );
};

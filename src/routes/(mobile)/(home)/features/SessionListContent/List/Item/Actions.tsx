import { ActionIcon, DropdownMenu, Icon } from '@lobehub/ui';
import { App } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  Check,
  ExternalLink,
  ListTree,
  LucideCopy,
  LucidePlus,
  MoreVertical,
  Pin,
  PinOff,
  Trash,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/index';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { SessionDefaultGroup } from '@/types/index';

const styles = createStaticStyles(({ css }) => ({
  modalRoot: css`
    z-index: 2000;
  `,
}));

interface ActionProps {
  group: string | undefined;
  id: string;
  openCreateGroupModal: () => void;
  parentType: 'agent' | 'group';
  pinned: boolean;
  setOpen: (open: boolean) => void;
}

const Actions = memo<ActionProps>(
  ({ group, id, openCreateGroupModal, parentType, pinned, setOpen }) => {
    const { t } = useTranslation('chat');

    const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

    const customAgentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);
    const [
      pinAgent,
      pinAgentGroup,
      duplicateAgent,
      duplicateAgentGroup,
      removeAgent,
      removeAgentGroup,
      updateAgentGroup,
    ] = useHomeStore((s) => [
      s.pinAgent,
      s.pinAgentGroup,
      s.duplicateAgent,
      s.duplicateAgentGroup,
      s.removeAgent,
      s.removeAgentGroup,
      s.updateAgentGroup,
    ]);

    const { modal, message } = App.useApp();

    const isDefault = group === SessionDefaultGroup.Default;

    const items = useMemo(
      () => {
        const moveGroupItems: ItemType[] =
          parentType === 'agent'
            ? [
                {
                  children: [
                    ...customAgentGroups.map(({ id: groupId, name }) => ({
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
                    {
                      type: 'divider' as const,
                    },
                    {
                      icon: <Icon icon={LucidePlus} />,
                      key: 'createGroup',
                      label: <div>{t('sessionGroup.createGroup')}</div>,
                      onClick: ({ domEvent }: { domEvent: Event }) => {
                        domEvent.stopPropagation();
                        openCreateGroupModal();
                      },
                    },
                  ],
                  icon: <Icon icon={ListTree} />,
                  key: 'moveGroup',
                  label: t('sessionGroup.moveGroup'),
                },
                {
                  type: 'divider' as const,
                },
              ]
            : [];

        return [
          {
            icon: <Icon icon={pinned ? PinOff : Pin} />,
            key: 'pin',
            label: t(pinned ? 'pinOff' : 'pin'),
            onClick: () => {
              if (parentType === 'group') {
                pinAgentGroup(id, !pinned);
              } else {
                pinAgent(id, !pinned);
              }
            },
          },
          {
            icon: <Icon icon={LucideCopy} />,
            key: 'duplicate',
            label: t('duplicate', { ns: 'common' }),
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();

              if (parentType === 'group') {
                duplicateAgentGroup(id);
              } else {
                duplicateAgent(id);
              }
            },
          },
          ...(isDesktop
            ? [
                {
                  icon: <Icon icon={ExternalLink} />,
                  key: 'openInNewWindow',
                  label: t('openInNewWindow'),
                  onClick: ({ domEvent }: { domEvent: Event }) => {
                    domEvent.stopPropagation();
                    openAgentInNewWindow(id);
                  },
                } satisfies ItemType,
              ]
            : []),
          {
            type: 'divider' as const,
          },
          ...moveGroupItems,
          {
            danger: true,
            icon: <Icon icon={Trash} />,
            key: 'delete',
            label: t('delete', { ns: 'common' }),
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
              modal.confirm({
                centered: true,
                classNames: {
                  root: styles.modalRoot,
                },
                okButtonProps: { danger: true },
                onOk: async () => {
                  if (parentType === 'group') {
                    await removeAgentGroup(id);
                    message.success(t('confirmRemoveGroupSuccess'));
                  } else {
                    await removeAgent(id);
                    message.success(t('confirmRemoveSessionSuccess'));
                  }
                },
                title:
                  parentType === 'group'
                    ? t('confirmRemoveChatGroupItemAlert')
                    : t('confirmRemoveSessionItemAlert'),
              });
            },
          },
        ] as ItemType[];
      },
      [
        duplicateAgent,
        duplicateAgentGroup,
        group,
        id,
        isDefault,
        message,
        modal,
        openAgentInNewWindow,
        openCreateGroupModal,
        parentType,
        pinAgent,
        pinAgentGroup,
        pinned,
        removeAgent,
        removeAgentGroup,
        customAgentGroups,
        t,
        updateAgentGroup,
      ],
    );

    return (
      <DropdownMenu items={items} onOpenChange={setOpen}>
        <ActionIcon
          icon={MoreVertical}
          size={{
            blockSize: 28,
            size: 16,
          }}
        />
      </DropdownMenu>
    );
  },
);

export default Actions;

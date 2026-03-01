import { ActionIcon, DropdownMenu, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { type ItemType } from 'antd/es/menu/interface';
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
import { useSessionStore } from '@/store/session';
import { sessionHelpers } from '@/store/session/helpers';
import { sessionGroupSelectors, sessionSelectors } from '@/store/session/selectors';
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
  setOpen: (open: boolean) => void;
}

const Actions = memo<ActionProps>(({ group, id, openCreateGroupModal, parentType, setOpen }) => {
  const { t } = useTranslation('chat');

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  const sessionCustomGroups = useSessionStore(sessionGroupSelectors.sessionGroupItems, isEqual);
  const [pin, removeSession, pinSession, sessionType, duplicateSession, updateSessionGroup] =
    useSessionStore((s) => {
      const session = sessionSelectors.getSessionById(id)(s);
      return [
        sessionHelpers.getSessionPinned(session),
        s.removeSession,
        s.pinSession,
        session.type,
        s.duplicateSession,
        s.updateSessionGroupId,
      ];
    });

  const [pinAgentGroup, removeAgentGroup] = useHomeStore((s) => [
    s.pinAgentGroup,
    s.removeAgentGroup,
  ]);

  const { modal, message } = App.useApp();

  const isDefault = group === SessionDefaultGroup.Default;

  const items = useMemo(
    () =>
      (
        [
          {
            icon: <Icon icon={pin ? PinOff : Pin} />,
            key: 'pin',
            label: t(pin ? 'pinOff' : 'pin'),
            onClick: () => {
              if (parentType === 'group') {
                pinAgentGroup(id, !pin);
              } else {
                pinSession(id, !pin);
              }
            },
          },
          {
            icon: <Icon icon={LucideCopy} />,
            key: 'duplicate',
            label: t('duplicate', { ns: 'common' }),
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();

              duplicateSession(id);
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
                },
              ]
            : []),
          {
            type: 'divider',
          },
          {
            children: [
              ...sessionCustomGroups.map(({ id: groupId, name }) => ({
                icon: group === groupId ? <Icon icon={Check} /> : <div />,
                key: groupId,
                label: name,
                onClick: () => {
                  updateSessionGroup(id, groupId);
                },
              })),
              {
                icon: isDefault ? <Icon icon={Check} /> : <div />,
                key: 'defaultList',
                label: t('defaultList'),
                onClick: () => {
                  updateSessionGroup(id, SessionDefaultGroup.Default);
                },
              },
              {
                type: 'divider',
              },
              {
                icon: <Icon icon={LucidePlus} />,
                key: 'createGroup',
                label: <div>{t('sessionGroup.createGroup')}</div>,
                onClick: ({ domEvent }) => {
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
            type: 'divider',
          },
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
                    await removeSession(id);
                    message.success(t('confirmRemoveSessionSuccess'));
                  }
                },
                title:
                  sessionType === 'group'
                    ? t('confirmRemoveChatGroupItemAlert')
                    : t('confirmRemoveSessionItemAlert'),
              });
            },
          },
        ] as ItemType[]
      ).filter(Boolean),
    [id, pin, openAgentInNewWindow],
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
});

export default Actions;

import { ActionIcon, DropdownMenu, Icon } from '@lobehub/ui';
import { confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { type ItemType } from 'antd/es/menu/interface';
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
import { usePermission } from '@/hooks/usePermission';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';
import { useSessionStore } from '@/store/session';
import { sessionHelpers } from '@/store/session/helpers';
import { sessionGroupSelectors, sessionSelectors } from '@/store/session/selectors';
import { SessionDefaultGroup } from '@/types/index';

interface ActionProps {
  group: string | undefined;
  id: string;
  openCreateGroupModal: () => void;
  parentType: 'agent' | 'group';
  setOpen: (open: boolean) => void;
}

const Actions = memo<ActionProps>(({ group, id, openCreateGroupModal, parentType, setOpen }) => {
  const { t } = useTranslation('chat');
  const { allowed: canCreate, reason: createReason } = usePermission('create_content');
  const { allowed: canEdit, reason: editReason } = usePermission('edit_own_content');

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

  const { message } = App.useApp();

  const isDefault = group === SessionDefaultGroup.Default;

  const items = useMemo(
    () =>
      (
        [
          {
            disabled: !canEdit,
            icon: <Icon icon={pin ? PinOff : Pin} />,
            key: 'pin',
            label: t(pin ? 'pinOff' : 'pin'),
            title: editReason,
            onClick: () => {
              if (!canEdit) return;
              if (parentType === 'group') {
                pinAgentGroup(id, !pin);
              } else {
                pinSession(id, !pin);
              }
            },
          },
          {
            disabled: !canCreate,
            icon: <Icon icon={LucideCopy} />,
            key: 'duplicate',
            label: t('duplicate', { ns: 'common' }),
            title: createReason,
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
              if (!canCreate) return;

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
                disabled: !canEdit,
                icon: group === groupId ? <Icon icon={Check} /> : <div />,
                key: groupId,
                label: name,
                title: editReason,
                onClick: () => {
                  if (!canEdit) return;
                  updateSessionGroup(id, groupId);
                },
              })),
              {
                disabled: !canEdit,
                icon: isDefault ? <Icon icon={Check} /> : <div />,
                key: 'defaultList',
                label: t('defaultList'),
                title: editReason,
                onClick: () => {
                  if (!canEdit) return;
                  updateSessionGroup(id, SessionDefaultGroup.Default);
                },
              },
              {
                type: 'divider',
              },
              {
                disabled: !canCreate,
                icon: <Icon icon={LucidePlus} />,
                key: 'createGroup',
                label: <div>{t('sessionGroup.createGroup')}</div>,
                title: createReason,
                onClick: ({ domEvent }) => {
                  domEvent.stopPropagation();
                  if (!canCreate) return;
                  openCreateGroupModal();
                },
              },
            ],
            disabled: !canEdit,
            icon: <Icon icon={ListTree} />,
            key: 'moveGroup',
            label: t('sessionGroup.moveGroup'),
            title: editReason,
          },
          {
            type: 'divider',
          },
          {
            danger: true,
            disabled: !canEdit,
            icon: <Icon icon={Trash} />,
            key: 'delete',
            label: t('delete', { ns: 'common' }),
            title: editReason,
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
              if (!canEdit) return;
              confirmModal({
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
    [
      canCreate,
      canEdit,
      createReason,
      duplicateSession,
      editReason,
      group,
      id,
      isDefault,
      openAgentInNewWindow,
      openCreateGroupModal,
      parentType,
      pin,
      pinAgentGroup,
      pinSession,
      removeAgentGroup,
      removeSession,
      sessionCustomGroups,
      sessionType,
      t,
      updateSessionGroup,
      message,
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
});

export default Actions;

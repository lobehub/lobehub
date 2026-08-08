import { ActionIcon, DropdownMenu, Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
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
import { homeAgentListSelectors } from '@/store/home/selectors';
import { isForbiddenError, isOwnerOnlyForbiddenError } from '@/utils/forbiddenError';

interface ActionProps {
  group: string | undefined;
  id: string;
  openCreateGroupModal: () => void;
  setOpen: (open: boolean) => void;
}

const Actions = memo<ActionProps>(({ group, id, openCreateGroupModal, setOpen }) => {
  const { t } = useTranslation('chat');
  const { allowed: canCreate, reason: createReason } = usePermission('create_content');
  const { allowed: canEdit, reason: editReason } = usePermission('edit_own_content');

  const openAgentInNewWindow = useGlobalStore((s) => s.openAgentInNewWindow);

  // Reuse agentGroups for the move-to-group dropdown
  const customAgentGroups = useHomeStore(homeAgentListSelectors.agentGroups, isEqual);

  const [pinAgent, duplicateAgent, removeAgent, updateAgentGroup] = useHomeStore((s) => [
    s.pinAgent,
    s.duplicateAgent,
    s.removeAgent,
    s.updateAgentGroup,
  ]);

  const item = useHomeStore((s) => homeAgentListSelectors.getAgentById(id)(s));
  const pinned = item?.pinned ?? false;
  const isDefault = group === undefined || group === 'default';

  const items = useMemo(
    () =>
      (
        [
          {
            disabled: !canEdit,
            icon: <Icon icon={pinned ? PinOff : Pin} />,
            key: 'pin',
            label: t(pinned ? 'pinOff' : 'pin'),
            title: editReason,
            onClick: () => {
              if (!canEdit) return;
              pinAgent(id, !pinned);
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
              duplicateAgent(id);
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
              ...customAgentGroups.map(({ id: groupId, name }) => ({
                disabled: !canEdit,
                icon: group === groupId ? <Icon icon={Check} /> : <div />,
                key: groupId,
                label: name,
                title: editReason,
                onClick: () => {
                  if (!canEdit) return;
                  updateAgentGroup(id, groupId);
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
                  updateAgentGroup(id, null);
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
                  try {
                    await removeAgent(id);
                    toast.success(t('confirmRemoveSessionSuccess'));
                  } catch (error) {
                    toast.error(
                      isOwnerOnlyForbiddenError(error)
                        ? t('deleteSharedOwnerOnly', { ns: 'common' })
                        : isForbiddenError(error)
                          ? t('manageOnlyCreator', { ns: 'common' })
                          : t('operationFailed', { ns: 'common' }),
                    );
                  }
                },
                title: t('confirmRemoveSessionItemAlert'),
              });
            },
          },
        ] as ItemType[]
      ).filter(Boolean),
    [
      canCreate,
      canEdit,
      createReason,
      customAgentGroups,
      duplicateAgent,
      editReason,
      group,
      id,
      isDefault,
      openAgentInNewWindow,
      openCreateGroupModal,
      pinAgent,
      pinned,
      removeAgent,
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
});

export default Actions;

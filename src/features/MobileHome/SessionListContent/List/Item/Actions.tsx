import { type SidebarAgentItem } from '@lobechat/types';
import { type DropdownItem, Icon, toast } from '@lobehub/ui';
import { ActionIcon, confirmModal, DropdownMenu } from '@lobehub/ui';
import { Check, Copy, ListTree, MoreVertical, Pin, PinOff, Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { confirmRemoveAgent } from '@/features/AgentDeleteConfirm';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useResourceManageable } from '@/hooks/useResourceManageable';
import { chatGroupService } from '@/services/chatGroup';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { getDeleteErrorMessageKey } from '@/utils/forbiddenError';

import { openCreateGroupModal } from '../../Modals/CreateGroupModal';

const Actions = ({
  item,
  groupId,
  setOpen,
}: {
  item: SidebarAgentItem;
  groupId?: string | null;
  setOpen: (open: boolean) => void;
}) => {
  const navigate = useWorkspaceAwareNavigate();
  const { t } = useTranslation(['chat', 'common']);
  const { allowed: canCreate, reason: createReason } = usePermission('create_content');
  const { allowed: canEdit, reason: editReason } = usePermission('edit_own_content');
  const access = useResourceAccess(item.type === 'group' ? 'agentGroup' : 'agent', item.id);
  const manageable = useResourceManageable(item.userId);
  const editable = canEdit && access.isAccessResolved && access.canEditResource;
  const groups = useHomeStore(
    item.visibility === 'private'
      ? homeAgentListSelectors.privateAgentGroups
      : homeAgentListSelectors.agentGroups,
  );
  const [
    pinAgent,
    pinAgentGroup,
    duplicateAgent,
    duplicateAgentGroup,
    removeAgent,
    removeAgentGroup,
    updateAgentGroup,
    refreshAgentList,
  ] = useHomeStore((s) => [
    s.pinAgent,
    s.pinAgentGroup,
    s.duplicateAgent,
    s.duplicateAgentGroup,
    s.removeAgent,
    s.removeAgentGroup,
    s.updateAgentGroup,
    s.refreshAgentList,
  ]);
  const [loading, setLoading] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (loading) return;
    setLoading(true);
    try {
      await action();
    } finally {
      setLoading(false);
    }
  };
  const move = (target: string | null) =>
    run(async () => {
      if (item.type === 'group') {
        await chatGroupService.updateGroup(item.id, { groupId: target });
        await refreshAgentList();
      } else await updateAgentGroup(item.id, target);
    });
  const items: DropdownItem[] = [
    {
      key: 'pin',
      title: editReason,
      disabled: !editable,
      icon: <Icon icon={item.pinned ? PinOff : Pin} />,
      label: t(item.pinned ? 'pinOff' : 'pin'),
      onClick: () =>
        run(() => (item.type === 'group' ? pinAgentGroup : pinAgent)(item.id, !item.pinned)),
    },
    {
      key: 'duplicate',
      title: createReason,
      disabled:
        !canCreate ||
        !access.isAccessResolved ||
        !(item.type === 'group' ? access.canEditResource : access.canUseResource),
      icon: <Icon icon={Copy} />,
      label: t('duplicate', { ns: 'common' }),
      onClick: () =>
        run(async () => {
          const id = await (item.type === 'group' ? duplicateAgentGroup : duplicateAgent)(item.id);
          if (id) navigate(`/${item.type === 'group' ? 'group' : 'agent'}/${id}`);
        }),
    },
    { type: 'divider' },
    {
      key: 'moveGroup',
      title: editReason,
      disabled: !editable,
      icon: <Icon icon={ListTree} />,
      label: t('sessionGroup.moveGroup'),
      children: [
        ...groups.map((group) => ({
          key: group.id,
          icon: group.id === groupId ? <Icon icon={Check} /> : undefined,
          label: group.name,
          onClick: () => move(group.id),
        })),
        {
          key: 'default',
          icon: groupId === null ? <Icon icon={Check} /> : undefined,
          label: t('defaultList'),
          onClick: () => move(null),
        },
        { type: 'divider' },
        {
          key: 'createGroup',
          title: createReason,
          disabled: !canCreate,
          icon: <Icon icon={Plus} />,
          label: t('sessionGroup.createGroup'),
          onClick: () => openCreateGroupModal(item.id, item.type, item.visibility),
        },
      ],
    },
    { type: 'divider' },
    {
      key: 'delete',
      title: editReason,
      danger: true,
      disabled: !editable || !manageable || !access.canManageResource,
      icon: <Icon icon={Trash} />,
      label: t('delete', { ns: 'common' }),
      onClick: () => {
        const onDelete = () =>
          run(async () => {
            try {
              await (item.type === 'group' ? removeAgentGroup : removeAgent)(item.id);
              toast.success(
                t(
                  item.type === 'group'
                    ? 'confirmRemoveGroupSuccess'
                    : 'confirmRemoveSessionSuccess',
                ),
              );
            } catch (error) {
              toast.error(t(getDeleteErrorMessageKey(error), { ns: 'common' }));
            }
          });

        if (item.type !== 'group') {
          void confirmRemoveAgent({ agentId: item.id, onConfirm: onDelete });
          return;
        }

        confirmModal({
          title: t('delete', { ns: 'common' }),
          content: t('confirmRemoveChatGroupItemAlert'),
          okText: t('delete', { ns: 'common' }),
          okButtonProps: { danger: true },
          onOk: onDelete,
        });
      },
    },
  ];
  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.currentTarget.contains(e.target as Node)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <DropdownMenu items={items} onOpenChange={setOpen}>
        <ActionIcon
          icon={MoreVertical}
          loading={loading}
          size={{ blockSize: 28, size: 16 }}
          title={t('more', { ns: 'common' })}
        />
      </DropdownMenu>
    </div>
  );
};
export default Actions;

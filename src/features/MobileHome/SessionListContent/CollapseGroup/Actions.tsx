import {
  type DropdownItem,
  type DropdownMenuProps,
  type MenuInfo,
  type MenuItemType,
} from '@lobehub/ui';
import { ActionIcon, confirmModal, DropdownMenu, Icon, toast } from '@lobehub/ui';
import { MoreVertical, PencilLine, Plus, Settings2, Trash, UsersRound } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MemberSelectionModal } from '@/components/MemberSelectionModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useHomeStore } from '@/store/home';

import { useCreateAgent } from '../../useCreateAgent';

interface ActionsProps extends Pick<DropdownMenuProps, 'onOpenChange'> {
  id?: string;
  isCustomGroup?: boolean;
  isPinned?: boolean;
  openConfigModal: () => void;
  openRenameModal?: () => void;
  visibility?: 'private' | 'public';
}

const Actions = memo<ActionsProps>(
  ({ id, visibility, openRenameModal, openConfigModal, onOpenChange, isCustomGroup, isPinned }) => {
    const { t } = useTranslation(['chat', 'common']);

    const isMobile = useIsMobile();
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);

    const { create, loading, allowed: canCreate, reason: createReason } = useCreateAgent();
    const { allowed: canEdit } = usePermission('edit_own_content');
    const [removeSessionGroup, refreshAgentList] = useHomeStore((s) => [
      s.removeGroup,
      s.refreshAgentList,
    ]);

    const [createGroup] = useAgentGroupStore((s) => [s.createGroup]);

    const sessionGroupConfigPublicItem: MenuItemType = {
      icon: <Icon icon={Settings2} />,
      key: 'config',
      label: t('sessionGroup.config'),
      onClick: ({ domEvent }: MenuInfo) => {
        domEvent.stopPropagation();
        openConfigModal();
      },
    };

    const newAgentPublicItem: MenuItemType = {
      icon: <Icon icon={Plus} />,
      disabled: !canCreate || loading,
      key: 'newAgent',
      label: t('newAgent'),
      title: createReason,
      onClick: async ({ domEvent }: MenuInfo) => {
        domEvent.stopPropagation();
        const creatingToast = toast.loading(t('sessionGroup.creatingAgent'));
        try {
          const result = await create({ groupId: id, pinned: isPinned, visibility });
          if (result && !result.hasWarnings) toast.success(t('sessionGroup.createAgentSuccess'));
        } finally {
          creatingToast.close();
        }
      },
    };

    const newGroupChatItem: MenuItemType = {
      icon: <Icon icon={UsersRound} />,
      disabled: !canCreate,
      key: 'newGroupChat',
      label: t('newGroupChat'),
      onClick: ({ domEvent }: MenuInfo) => {
        domEvent.stopPropagation();
        if (canCreate) setIsGroupModalOpen(true);
      },
    };

    const handleCreateGroupWithMembers = async (
      selectedAgents: string[],
      hostConfig?: { model?: string; provider?: string },
      enableSupervisor?: boolean,
    ) => {
      try {
        if (!canCreate || isCreatingGroup) return;
        setIsCreatingGroup(true);

        const config: any = {};

        if (enableSupervisor !== undefined) {
          config.enableSupervisor = enableSupervisor;
        }

        if (hostConfig) {
          config.orchestratorModel = hostConfig.model;
          config.orchestratorProvider = hostConfig.provider;
        }

        await createGroup(
          {
            config: Object.keys(config).length > 0 ? config : undefined,
            title: 'New Group Chat',
            groupId: id,
            pinned: isPinned,
            visibility,
          },
          selectedAgents,
        );
        await refreshAgentList();
        setIsGroupModalOpen(false);
      } catch (error) {
        console.error('Failed to create group:', error);
        toast.error(t('sessionGroup.createGroupFailed'));
      } finally {
        setIsCreatingGroup(false);
      }
    };

    const handleGroupModalCancel = () => {
      setIsGroupModalOpen(false);
    };

    const customGroupItems: DropdownItem[] = [
      {
        icon: <Icon icon={PencilLine} />,
        disabled: !canEdit,
        key: 'rename',
        label: t('sessionGroup.rename'),
        onClick: ({ domEvent }: MenuInfo) => {
          domEvent.stopPropagation();
          openRenameModal?.();
        },
      },
      sessionGroupConfigPublicItem,
      {
        type: 'divider',
      },
      {
        danger: true,
        icon: <Icon icon={Trash} />,
        disabled: !canEdit,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: ({ domEvent }: MenuInfo) => {
          domEvent.stopPropagation();
          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: t('sessionGroup.confirmRemoveGroupAlert'),
            okButtonProps: { danger: true },
            okText: t('delete', { ns: 'common' }),
            onOk: async () => {
              if (!id) return;
              await removeSessionGroup(id);
            },
            title: t('delete', { ns: 'common' }),
          });
        },
      },
    ];
    const tailItems = isCustomGroup ? customGroupItems : [sessionGroupConfigPublicItem];
    const menuItems: DropdownItem[] = [
      newAgentPublicItem,
      newGroupChatItem,
      { type: 'divider' },
      ...tailItems,
    ];

    return (
      <>
        <DropdownMenu items={menuItems} onOpenChange={onOpenChange}>
          <ActionIcon
            aria-label={t('more', { ns: 'common' })}
            icon={MoreVertical}
            loading={isCreatingGroup}
            size={{ blockSize: isMobile ? 44 : 22, size: 16 }}
            style={isMobile ? undefined : { marginRight: -8 }}
            title={t('more', { ns: 'common' })}
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
        </DropdownMenu>

        <MemberSelectionModal
          mode="create"
          open={isGroupModalOpen}
          onCancel={handleGroupModalCancel}
          onConfirm={handleCreateGroupWithMembers}
        />
      </>
    );
  },
);

export default Actions;

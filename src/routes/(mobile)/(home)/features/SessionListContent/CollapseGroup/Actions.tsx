import { type DropdownMenuProps, type MenuProps } from '@lobehub/ui';
import { ActionIcon, DropdownMenu, Icon } from '@lobehub/ui';
import { App } from 'antd';
import { createStaticStyles } from 'antd-style';
import { MoreVertical, PencilLine, Plus, Settings2, Trash, UsersRound } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MemberSelectionModal } from '@/components/MemberSelectionModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useSessionStore } from '@/store/session';

const styles = createStaticStyles(({ css }) => ({
  modalRoot: css`
    z-index: 2000;
  `,
}));
interface ActionsProps extends Pick<DropdownMenuProps, 'onOpenChange'> {
  id?: string;
  isCustomGroup?: boolean;
  isPinned?: boolean;
  openConfigModal: () => void;
  openRenameModal?: () => void;
}

type ItemOfType<T> = T extends (infer Item)[] ? Item : never;
type MenuItemType = ItemOfType<MenuProps['items']>;

const Actions = memo<ActionsProps>(
  ({ id, openRenameModal, openConfigModal, onOpenChange, isCustomGroup, isPinned }) => {
    const { t } = useTranslation('chat');
    const { modal, message } = App.useApp();

    const isMobile = useIsMobile();
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);

    const [createSession, removeSessionGroup] = useSessionStore((s) => [
      s.createSession,
      s.removeSessionGroup,
    ]);

    const [createGroup] = useAgentGroupStore((s) => [s.createGroup]);

    const sessionGroupConfigPublicItem: MenuItemType = {
      icon: <Icon icon={Settings2} />,
      key: 'config',
      label: t('sessionGroup.config'),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        openConfigModal();
      },
    };

    const newAgentPublicItem: MenuItemType = {
      icon: <Icon icon={Plus} />,
      key: 'newAgent',
      label: t('newAgent'),
      onClick: async ({ domEvent }) => {
        domEvent.stopPropagation();
        const key = 'createNewAgentInGroup';
        message.loading({ content: t('sessionGroup.creatingAgent'), duration: 0, key });

        await createSession({ group: id, pinned: isPinned });

        message.destroy(key);
        message.success({ content: t('sessionGroup.createAgentSuccess') });
      },
    };

    const newGroupChatItem: MenuItemType = {
      icon: <Icon icon={UsersRound} />,
      key: 'newGroupChat',
      label: t('newGroupChat'),
      onClick: ({ domEvent }) => {
        domEvent.stopPropagation();
        setIsGroupModalOpen(true);
      },
    };

    const handleCreateGroupWithMembers = async (
      selectedAgents: string[],
      hostConfig?: { model?: string; provider?: string },
      enableSupervisor?: boolean,
    ) => {
      try {
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
          },
          selectedAgents,
        );
        setIsGroupModalOpen(false);
      } catch (error) {
        console.error('Failed to create group:', error);
        message.error({ content: t('sessionGroup.createGroupFailed') });
      } finally {
        setIsCreatingGroup(false);
      }
    };

    const handleGroupModalCancel = () => {
      setIsGroupModalOpen(false);
    };

    const customGroupItems: MenuProps['items'] = useMemo(
      () => [
        {
          icon: <Icon icon={PencilLine} />,
          key: 'rename',
          label: t('sessionGroup.rename'),
          onClick: ({ domEvent }) => {
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
                if (!id) return;
                await removeSessionGroup(id);
              },
              title: t('sessionGroup.confirmRemoveGroupAlert'),
            });
          },
        },
      ],
      [],
    );

    const defaultItems: MenuProps['items'] = useMemo(() => [sessionGroupConfigPublicItem], []);

    const tailItems = useMemo(
      () => (isCustomGroup ? customGroupItems : defaultItems),
      [isCustomGroup, customGroupItems, defaultItems],
    );

    const menuItems = useMemo(() => {
      return [newAgentPublicItem, newGroupChatItem, { type: 'divider' as const }, ...tailItems];
    }, [newAgentPublicItem, newGroupChatItem, tailItems]);

    return (
      <>
        <DropdownMenu items={menuItems} onOpenChange={onOpenChange}>
          <ActionIcon
            active={isMobile ? true : false}
            icon={MoreVertical}
            loading={isCreatingGroup}
            size={{ blockSize: 22, size: 16 }}
            style={{ background: isMobile ? 'transparent' : '', marginRight: -8 }}
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

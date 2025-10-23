import { ActionIcon, Dropdown, type DropdownProps, Icon, type MenuProps } from '@lobehub/ui';
import { App } from 'antd';
import { createStyles } from 'antd-style';
import { MoreVertical, PencilLine, Plus, Settings2, Trash, UsersRound } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MemberSelectionModal } from '@/components/MemberSelectionModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatGroupStore } from '@/store/chatGroup';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';

const useStyles = createStyles(({ css }) => ({
  modalRoot: css`
    z-index: 2000;
  `,
}));
interface ActionsProps extends Pick<DropdownProps, 'onOpenChange'> {
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
    const { styles } = useStyles();
    const { modal, message } = App.useApp();

    const isMobile = useIsMobile();
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);

    const [createSession, removeSessionGroup] = useSessionStore((s) => [
      s.createSession,
      s.removeSessionGroup,
    ]);

    const [createGroup] = useChatGroupStore((s) => [s.createGroup]);

    const { showCreateSession, enableGroupChat } = useServerConfigStore(featureFlagsSelectors);

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
        message.success({ content: t('sessionGroup.createGroupSuccess') });
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
              okButtonProps: { danger: true },
              onOk: async () => {
                if (!id) return;
                await removeSessionGroup(id);
              },
              rootClassName: styles.modalRoot,
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
      const items: MenuProps['items'] = [];

      if (showCreateSession) {
        items.push(newAgentPublicItem);

        if (enableGroupChat) {
          items.push(newGroupChatItem);
        }

        items.push({ type: 'divider' });
      }

      items.push(...tailItems);

      return items;
    }, [showCreateSession, enableGroupChat, newAgentPublicItem, newGroupChatItem, tailItems]);

    return (
      <>
        <Dropdown
          arrow={false}
          menu={{
            items: menuItems,
            onClick: ({ domEvent }) => {
              domEvent.stopPropagation();
            },
          }}
          onOpenChange={onOpenChange}
          trigger={['click']}
        >
          <ActionIcon
            active={isMobile ? true : false}
            icon={MoreVertical}
            loading={isCreatingGroup}
            onClick={(e) => {
              e.stopPropagation();
            }}
            size={{ blockSize: 22, size: 16 }}
            style={{ background: isMobile ? 'transparent' : '', marginRight: -8 }}
          />
        </Dropdown>

        {enableGroupChat && (
          <MemberSelectionModal
            mode="create"
            onCancel={handleGroupModalCancel}
            onConfirm={handleCreateGroupWithMembers}
            open={isGroupModalOpen}
          />
        )}
      </>
    );
  },
);

export default Actions;

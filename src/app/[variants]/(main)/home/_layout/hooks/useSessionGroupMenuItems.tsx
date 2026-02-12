import { Icon } from '@lobehub/ui';
import { App } from 'antd';
import { type ItemType } from 'antd/es/menu/interface';
import { createStaticStyles } from 'antd-style';
import { FolderCogIcon, FolderPenIcon, Trash } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupTemplates } from '@/components/ChatGroupWizard/templates';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useHomeStore } from '@/store/home';

const styles = createStaticStyles(({ css }) => ({
  modalRoot: css`
    z-index: 2000;
  `,
}));

/**
 * Hook for generating menu items for session group containers
 * Used in List/Group/Actions.tsx
 */
export const useSessionGroupMenuItems = () => {
  const { t } = useTranslation('chat');
  const { modal, message } = App.useApp();
  const groupTemplates = useGroupTemplates();

  const [storeCreateAgent] = useAgentStore((s) => [s.createAgent]);
  const [removeGroup, refreshAgentList] = useHomeStore((s) => [s.removeGroup, s.refreshAgentList]);
  const [createGroup] = useAgentGroupStore((s) => [s.createGroup]);

  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  /**
   * Rename group menu item
   */
  const renameGroupMenuItem = useCallback(
    (onToggleEdit: (visible?: boolean) => void): ItemType => {
      const iconElement = <Icon icon={FolderPenIcon} />;
      return {
        icon: iconElement,
        key: 'rename',
        label: t('sessionGroup.rename'),
        onClick: (info: any) => {
          info.domEvent?.stopPropagation();
          onToggleEdit(true);
        },
      };
    },
    [t],
  );

  /**
   * Config group menu item
   */
  const configGroupMenuItem = useCallback(
    (onOpenConfig: () => void): ItemType => {
      const iconElement = <Icon icon={FolderCogIcon} />;
      return {
        icon: iconElement,
        key: 'config',
        label: t('sessionGroup.config'),
        onClick: (info: any) => {
          info.domEvent?.stopPropagation();
          onOpenConfig();
        },
      };
    },
    [t],
  );

  /**
   * Delete group menu item with confirmation modal
   */
  const deleteGroupMenuItem = useCallback(
    (groupId: string): ItemType => {
      const trashIcon = <Icon icon={Trash} />;
      return {
        danger: true,
        icon: trashIcon,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        onClick: (info: any) => {
          info.domEvent?.stopPropagation();
          modal.confirm({
            centered: true,
            classNames: {
              root: styles.modalRoot,
            },
            okButtonProps: { danger: true },
            onOk: async () => {
              await removeGroup(groupId);
            },
            title: t('sessionGroup.confirmRemoveGroupAlert'),
          });
        },
      };
    },
    [t, modal, removeGroup, styles.modalRoot],
  );

  /**
   * Create agent in group menu item
   */
  const createAgentInGroupMenuItem = useCallback(
    (groupId: string, _isPinned?: boolean): ItemType => {
      const iconElement = <Icon icon={FolderPenIcon} />;
      return {
        icon: iconElement,
        key: 'createAgent',
        label: t('newAgent'),
        onClick: async (info: any) => {
          info.domEvent?.stopPropagation();

          const key = 'createNewAgent';
          message.loading({ content: t('sessionGroup.creatingAgent'), duration: 0, key });
          setIsCreatingAgent(true);

          try {
            await storeCreateAgent({ groupId });
            await refreshAgentList();

            message.destroy(key);
            message.success({ content: t('sessionGroup.createAgentSuccess') });
          } catch (error) {
            message.destroy(key);
            message.error({ content: t('sessionGroup.createGroupFailed') });
            throw error;
          } finally {
            setIsCreatingAgent(false);
          }
        },
      };
    },
    [t, message, storeCreateAgent, refreshAgentList],
  );

  /**
   * Create group chat in group menu item
   * Opens member selection modal
   */
  const createGroupChatInGroupMenuItem = useCallback(
    (
      _groupId: string,
      onOpenMemberSelection: (callbacks: {
        onCancel: () => void;
        onConfirm: (selectedAgents: string[]) => Promise<void>;
      }) => void,
    ): ItemType => {
      const iconElement = <Icon icon={FolderPenIcon} />;
      return {
        icon: iconElement,
        key: 'createGroupChat',
        label: t('newGroupChat'),
        onClick: async (info: any) => {
          info.domEvent?.stopPropagation();

          onOpenMemberSelection({
            onCancel: () => {},
            onConfirm: async (selectedAgents) => {
              setIsCreatingGroup(true);
              try {
                await createGroup(
                  {
                    config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
                    title: 'New Group Chat',
                  },
                  selectedAgents,
                );
              } catch (error) {
                console.error('Failed to create group:', error);
                message.error({ content: t('sessionGroup.createGroupFailed') });
              } finally {
                setIsCreatingGroup(false);
              }
            },
          });
        },
      };
    },
    [t, message, createGroup],
  );

  /**
   * Create group from template
   * Internal helper function used by create menu items
   */
  const createGroupFromTemplate = useCallback(
    async (templateId: string, selectedMemberTitles?: string[]) => {
      setIsCreatingGroup(true);
      try {
        const template = groupTemplates.find((t) => t.id === templateId);
        if (!template) {
          throw new Error(`Template ${templateId} not found`);
        }

        const membersToCreate =
          typeof selectedMemberTitles === 'undefined'
            ? template.members
            : template.members.filter((m) => selectedMemberTitles.includes(m.title));

        const memberAgentIds: string[] = [];
        for (const member of membersToCreate) {
          const result = await storeCreateAgent({
            config: {
              // MetaData fields
              avatar: member.avatar,

              backgroundColor: member.backgroundColor,

              description: `${member.title} - ${template.description}`,

              plugins: member.plugins,
              systemRole: member.systemRole,
              title: member.title,
              virtual: true,
            },
          });

          await refreshAgentList();

          // Get agentId directly from createAgent result
          if (result.agentId) {
            memberAgentIds.push(result.agentId);
          }
        }

        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 1000);
        });

        await createGroup(
          {
            config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
            title: template.title,
          },
          memberAgentIds,
        );

        return true;
      } catch (error) {
        console.error('Failed to create group from template:', error);
        message.error({ content: t('sessionGroup.createGroupFailed') });
        return false;
      } finally {
        setIsCreatingGroup(false);
      }
    },
    [groupTemplates, storeCreateAgent, refreshAgentList, createGroup, message, t],
  );

  /**
   * Create group with members
   * Internal helper function used by create menu items
   */
  const createGroupWithMembers = useCallback(
    async (selectedAgents: string[], groupTitle?: string) => {
      setIsCreatingGroup(true);
      try {
        const title = groupTitle || t('defaultGroupChat');

        await createGroup(
          {
            config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
            title,
          },
          selectedAgents,
        );

        return true;
      } catch (error) {
        console.error('Failed to create group:', error);
        message.error({ content: t('sessionGroup.createGroupFailed') });
        return false;
      } finally {
        setIsCreatingGroup(false);
      }
    },
    [createGroup, message, t],
  );

  return {
    configGroupMenuItem,
    createAgentInGroupMenuItem,
    createGroupChatInGroupMenuItem,
    createGroupFromTemplate,
    createGroupWithMembers,
    deleteGroupMenuItem,
    isCreatingAgent,
    isCreatingGroup,
    renameGroupMenuItem,
  };
};

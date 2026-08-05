import type { SFSymbol } from '@lobechat/electron-client-ipc';
import { Icon } from '@lobehub/ui';
import { confirmModal, toast } from '@lobehub/ui/base-ui';
import { type ItemType } from 'antd/es/menu/interface';
import { FolderCogIcon, FolderPenIcon, Trash } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGroupTemplates } from '@/components/ChatGroupWizard/templates';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { openEditingPopover } from '@/features/EditingPopover/store';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useHomeStore } from '@/store/home';

type MenuItem = NonNullable<ItemType> & { sfSymbol?: SFSymbol };

/**
 * Hook for generating menu items for session group containers
 * Used in List/Group/Actions.tsx
 */
export const useSessionGroupMenuItems = () => {
  const { t } = useTranslation(['chat', 'common']);

  const groupTemplates = useGroupTemplates();
  const { allowed: canCreate } = usePermission('create_content');
  const { allowed: canEdit } = usePermission('edit_own_content');

  const [storeCreateAgent] = useAgentStore((s) => [s.createAgent]);
  const [removeGroup, refreshAgentList] = useHomeStore((s) => [s.removeGroup, s.refreshAgentList]);
  const [createGroup] = useAgentGroupStore((s) => [s.createGroup]);

  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  /**
   * Rename group menu item
   */
  const renameGroupMenuItem = useCallback(
    (groupId: string, groupName: string, anchor: HTMLElement | null): MenuItem => {
      const iconElement = <Icon icon={FolderPenIcon} />;
      return {
        disabled: !canEdit,
        icon: iconElement,
        key: 'rename',
        label: t('sessionGroup.rename'),
        sfSymbol: 'pencil',
        onClick: (info: any) => {
          info.domEvent?.stopPropagation();
          if (!canEdit) return;

          if (anchor) {
            openEditingPopover({ anchor, id: groupId, title: groupName, type: 'group' });
          }
        },
      };
    },
    [canEdit, t],
  );

  /**
   * Config group menu item.
   *
   * Deliberately NOT edit-gated: Category Management is also where a member
   * shows a Category back in their own sidebar, and that show/hide layer is
   * personal. The editing controls inside the modal carry their own
   * `canEdit` gate, so opening it grants nothing.
   */
  const configGroupMenuItem = useCallback(
    (onOpenConfig: () => void): MenuItem => {
      const iconElement = <Icon icon={FolderCogIcon} />;
      return {
        icon: iconElement,
        key: 'config',
        label: t('sessionGroup.config'),
        sfSymbol: 'folder.badge.gearshape',
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
    (groupId: string): MenuItem => {
      const trashIcon = <Icon icon={Trash} />;
      return {
        danger: true,
        disabled: !canEdit,
        icon: trashIcon,
        key: 'delete',
        label: t('delete', { ns: 'common' }),
        sfSymbol: 'trash',
        onClick: (info: any) => {
          info.domEvent?.stopPropagation();
          if (!canEdit) return;

          confirmModal({
            cancelText: t('cancel', { ns: 'common' }),
            content: t('sessionGroup.confirmRemoveGroupAlert'),
            okButtonProps: { danger: true },
            okText: t('delete', { ns: 'common' }),
            onOk: async () => {
              await removeGroup(groupId);
            },
            title: t('delete', { ns: 'common' }),
          });
        },
      };
    },
    [canEdit, t, removeGroup],
  );

  /**
   * Create agent in group menu item
   */
  const createAgentInGroupMenuItem = useCallback(
    (groupId: string, _isPinned?: boolean): MenuItem => {
      const iconElement = <Icon icon={FolderPenIcon} />;
      return {
        disabled: !canCreate,
        icon: iconElement,
        key: 'createAgent',
        label: t('newAgent'),
        sfSymbol: 'plus.bubble',
        onClick: async (info: any) => {
          info.domEvent?.stopPropagation();
          if (!canCreate) return;

          const creatingToast = toast.loading(t('sessionGroup.creatingAgent'));
          setIsCreatingAgent(true);

          try {
            await storeCreateAgent({ groupId });
            await refreshAgentList();

            creatingToast.close();
            toast.success(t('sessionGroup.createAgentSuccess'));
          } catch (error) {
            creatingToast.close();
            toast.error(t('sessionGroup.createGroupFailed'));
            throw error;
          } finally {
            setIsCreatingAgent(false);
          }
        },
      };
    },
    [canCreate, t, storeCreateAgent, refreshAgentList],
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
    ): MenuItem => {
      const iconElement = <Icon icon={FolderPenIcon} />;
      return {
        disabled: !canCreate,
        icon: iconElement,
        key: 'createGroupChat',
        label: t('newGroupChat'),
        sfSymbol: 'person.2',
        onClick: async (info: any) => {
          info.domEvent?.stopPropagation();
          if (!canCreate) return;

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
                toast.error(t('sessionGroup.createGroupFailed'));
              } finally {
                setIsCreatingGroup(false);
              }
            },
          });
        },
      };
    },
    [canCreate, t, createGroup],
  );

  /**
   * Create group from template
   * Internal helper function used by create menu items
   */
  const createGroupFromTemplate = useCallback(
    async (templateId: string, selectedMemberTitles?: string[]) => {
      if (!canCreate) return false;

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
        toast.error(t('sessionGroup.createGroupFailed'));
        return false;
      } finally {
        setIsCreatingGroup(false);
      }
    },
    [canCreate, groupTemplates, storeCreateAgent, refreshAgentList, createGroup, t],
  );

  /**
   * Create group with members
   * Internal helper function used by create menu items
   */
  const createGroupWithMembers = useCallback(
    async (selectedAgents: string[], groupTitle?: string) => {
      if (!canCreate) return false;

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
        toast.error(t('sessionGroup.createGroupFailed'));
        return false;
      } finally {
        setIsCreatingGroup(false);
      }
    },
    [canCreate, createGroup, t],
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

import type { SFSymbol } from '@lobechat/electron-client-ipc';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { toast } from '@lobehub/ui/base-ui';
import { GroupBotSquareIcon } from '@lobehub/ui/icons';
import type { ItemType } from 'antd/es/menu/interface';
import {
  BotIcon,
  FileTextIcon,
  FolderCogIcon,
  FolderPlus,
  ListPlusIcon,
  MonitorSmartphone,
  Store,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWRMutation from 'swr/mutation';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { useGroupTemplates } from '@/components/ChatGroupWizard/templates';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { openConnectAgentModal } from '@/features/ConnectAgent';
import { useOptionalAgentModal } from '@/features/HomeSidebar/Body/Agent/ModalProvider';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import type { CreateAgentParams } from '@/services/agent';
import type { GroupMemberConfig } from '@/services/chatGroup';
import { chatGroupService } from '@/services/chatGroup';
import { useAgentStore } from '@/store/agent';
import { useAgentGroupStore } from '@/store/agentGroup';
import { useHomeStore } from '@/store/home';
import { usePageStore } from '@/store/page';

type MenuItem = NonNullable<ItemType> & { sfSymbol?: SFSymbol };

interface CreateAgentOptions {
  groupId?: string;
  isPinned?: boolean;
  onSuccess?: () => void;
  /**
   * Forwarded to the server-side `visibility` column. Used by the sidebar's
   * "Create Private …" entries; defaults to undefined which the server reads
   * as `'public'`. Has no effect in personal mode.
   */
  visibility?: 'private' | 'public';
}

/**
 * Hook for generating menu items for top-level create actions
 * Used by the home sidebar create menus.
 */
export const useCreateMenuItems = () => {
  const { t } = useTranslation('chat');
  const { t: tFile } = useTranslation('file');

  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceId = useActiveWorkspaceId();
  const groupTemplates = useGroupTemplates();
  const { allowed: canCreate } = usePermission('create_content');

  const [storeCreateAgent] = useAgentStore((s) => [s.createAgent]);
  const [addGroup, refreshAgentList, switchToGroup] = useHomeStore((s) => [
    s.addGroup,
    s.refreshAgentList,
    s.switchToGroup,
  ]);
  const [createGroup, loadGroups] = useAgentGroupStore((s) => [s.createGroup, s.loadGroups]);
  const createNewPage = usePageStore((s) => s.createNewPage);

  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isCreatingSessionGroup, setIsCreatingSessionGroup] = useState(false);

  // SWR-based agent creation with auto navigation to profile
  const { trigger: mutateAgent, isMutating: isMutatingAgent } = useSWRMutation(
    'agent.createAgent',
    async (_key: string, { arg }: { arg?: CreateAgentParams }) => {
      const result = await storeCreateAgent(arg ?? {});
      return result;
    },
    {
      onSuccess: async (result) => {
        navigate(`/agent/${result.agentId}/profile`);
        await refreshAgentList();
      },
    },
  );

  // SWR-based group creation with auto navigation to profile
  const { trigger: mutateGroup, isMutating: isMutatingGroup } = useSWRMutation(
    'group.createGroup',
    async (_key: string, { arg }: { arg?: CreateAgentOptions & { title?: string } }) => {
      const groupId = await createGroup(
        {
          config: DEFAULT_CHAT_GROUP_CHAT_CONFIG,
          groupId: arg?.groupId,
          title: arg?.title || t('defaultGroupChat'),
          // Forward the caller's bucket choice — without it a "Create Private
          // Group" entry silently lands the group in the public bucket.
          ...(arg?.visibility ? { visibility: arg.visibility } : {}),
        },
        [],
        true, // silent mode - don't switch session, we'll navigate instead
      );
      return groupId;
    },
    {
      onSuccess: async (groupId) => {
        navigate(`/group/${groupId}/profile`);
        await refreshAgentList();
        await loadGroups();
      },
    },
  );

  /**
   * Create agent action (optionally with a prompt as systemRole)
   */
  const createAgent = useCallback(
    async (options?: CreateAgentOptions & { prompt?: string }) => {
      if (!canCreate) return;

      const config = options?.prompt ? { systemRole: options.prompt } : undefined;
      await mutateAgent({
        config,
        groupId: options?.groupId,
        visibility: options?.visibility,
      });
      options?.onSuccess?.();
    },
    [canCreate, mutateAgent],
  );

  /**
   * Create group from template
   * Uses backend batch creation for better performance and consistency
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

        // Prepare member configs for batch creation
        const memberConfigs: GroupMemberConfig[] = membersToCreate.map((member) => ({
          avatar: member.avatar,
          backgroundColor: member.backgroundColor,
          plugins: member.plugins,
          systemRole: member.systemRole,
          title: member.title,
        }));

        // Use batch creation endpoint - creates all agents and group in one request
        const { groupId } = await chatGroupService.createGroupWithMembers(
          {
            title: template.title,
          },
          memberConfigs,
        );

        // Switch to the new group
        switchToGroup(groupId);

        // Refresh data after creation
        await refreshAgentList();
        await loadGroups();

        return true;
      } catch (error) {
        console.error('Failed to create group from template:', error);
        toast.error(t('sessionGroup.createGroupFailed'));
        return false;
      } finally {
        setIsCreatingGroup(false);
      }
    },
    [canCreate, groupTemplates, refreshAgentList, loadGroups, switchToGroup, t],
  );

  /**
   * Create group with members
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

  /**
   * Create empty group and navigate to profile
   */
  const createEmptyGroup = useCallback(
    async (options?: CreateAgentOptions & { title?: string }) => {
      if (!canCreate) return;

      await mutateGroup(options);
    },
    [canCreate, mutateGroup],
  );

  const agentModal = useOptionalAgentModal();
  const openCreateModal = agentModal?.openCreateModal;
  const openCreateGroupModal = agentModal?.openCreateGroupModal;

  /**
   * Create agent menu item
   */
  const createAgentMenuItem = useCallback(
    (options?: CreateAgentOptions): MenuItem => ({
      icon: <Icon icon={BotIcon} />,
      disabled: !canCreate,
      // Key needs to vary by visibility so the public and private "New
      // Agent" entries can coexist (e.g. if a future menu lists both).
      key: options?.visibility === 'private' ? 'newPrivateAgent' : 'newAgent',
      label: t('newAgent'),
      sfSymbol: 'plus.bubble',
      onClick: async (info) => {
        info.domEvent?.stopPropagation();
        if (!canCreate) return;

        if (openCreateModal) {
          openCreateModal('agent', {
            ...(options?.groupId ? { groupId: options.groupId } : {}),
            ...(options?.visibility ? { visibility: options.visibility } : {}),
          });
        } else {
          await createAgent(options);
        }
      },
    }),
    [canCreate, t, createAgent, openCreateModal],
  );

  /**
   * Add market agent menu item
   */
  const createMarketAgentMenuItem = useCallback(
    (): MenuItem => ({
      icon: <Icon icon={Store} />,
      disabled: !canCreate,
      key: 'addAgentFromMarket',
      label: t('addAgentFromMarket'),
      sfSymbol: 'bag',
      onClick: (info) => {
        info.domEvent?.stopPropagation();
        if (!canCreate) return;

        navigate('/community/agent');
      },
    }),
    [canCreate, navigate, t],
  );

  /**
   * Open the complete Agent list, where shared Agents can be added to the
   * caller's sidebar without mutating the Agent itself.
   */
  const createAgentListMenuItem = useCallback(
    (options?: { visibility?: 'private' | 'public' }): MenuItem => ({
      icon: <Icon icon={ListPlusIcon} />,
      key: options?.visibility === 'private' ? 'addPrivateAgentFromList' : 'addAgentFromList',
      label: t('addAgentFromList'),
      sfSymbol: 'list.bullet',
      onClick: (info) => {
        info.domEvent?.stopPropagation();
        // Land the view-all page on the tab matching the caller's bucket.
        navigate(options?.visibility === 'private' ? '/agents?tab=private' : '/agents');
      },
    }),
    [navigate, t],
  );

  /**
   * Connect Agent menu item — the unified device-first wizard for external
   * agents installed on a local or connected machine.
   */
  const createConnectAgentMenuItem = useCallback(
    (options?: CreateAgentOptions): MenuItem | null => {
      return {
        icon: <Icon icon={MonitorSmartphone} />,
        disabled: !canCreate,
        key: 'newPlatformAgent',
        label: (
          <Flexbox gap={1}>
            <Text>{t('newPlatformAgent')}</Text>
            <Text fontSize={12} type={'secondary'}>
              {t('newPlatformAgentDesc')}
            </Text>
          </Flexbox>
        ),
        sfSymbol: 'laptopcomputer.and.iphone',
        onClick: (info) => {
          info.domEvent?.stopPropagation();
          if (!canCreate) return;
          openConnectAgentModal(
            options?.groupId || options?.visibility
              ? { groupId: options?.groupId, visibility: options?.visibility }
              : undefined,
          );
        },
      };
    },
    [t, canCreate],
  );

  /**
   * Create group chat menu item
   * Creates an empty group and navigates to its profile page
   */
  const createGroupChatMenuItem = useCallback(
    (options?: CreateAgentOptions): MenuItem => ({
      icon: <Icon icon={GroupBotSquareIcon} />,
      disabled: !canCreate,
      key: options?.visibility === 'private' ? 'newPrivateGroupChat' : 'newGroupChat',
      label: t('newGroupChat'),
      sfSymbol: 'person.2',
      onClick: async (info) => {
        info.domEvent?.stopPropagation();
        if (!canCreate) return;

        if (openCreateModal) {
          openCreateModal('group', {
            ...(options?.groupId ? { groupId: options.groupId } : {}),
            ...(options?.visibility ? { visibility: options.visibility } : {}),
          });
        } else {
          await createEmptyGroup(options);
        }
      },
    }),
    [canCreate, t, createEmptyGroup, openCreateModal],
  );

  /**
   * Add session group menu item
   */
  const createSessionGroupMenuItem = useCallback(
    (options?: { visibility?: 'private' | 'public' }): MenuItem => ({
      icon: <Icon icon={FolderPlus} />,
      disabled: !canCreate,
      key: options?.visibility === 'private' ? 'addPrivateSessionGroup' : 'addSessionGroup',
      label: t('sessionGroup.createGroup'),
      sfSymbol: 'folder.badge.plus',
      onClick: async (info) => {
        info.domEvent?.stopPropagation();
        if (!canCreate) return;

        if (openCreateGroupModal) {
          // Let the user name the group at creation time
          openCreateGroupModal(undefined, options?.visibility);
          return;
        }

        setIsCreatingSessionGroup(true);
        await addGroup(t('sessionGroup.newGroup'), options?.visibility);
        setIsCreatingSessionGroup(false);
      },
    }),
    [canCreate, t, addGroup, openCreateGroupModal],
  );

  /**
   * Config menu item
   */
  const configMenuItem = useCallback(
    (onOpenConfig: () => void): MenuItem => ({
      icon: <Icon icon={FolderCogIcon} />,
      key: 'config',
      label: t('sessionGroup.manageCategory'),
      sfSymbol: 'folder.badge.gearshape',
      onClick: (info) => {
        info.domEvent?.stopPropagation();
        onOpenConfig();
      },
    }),
    [t],
  );

  /**
   * Create page action
   */
  const createPage = useCallback(async () => {
    if (!canCreate) return;

    const untitledTitle = tFile('pageList.untitled');
    try {
      // In workspace mode the server auto-defaults top-level `sourceType: 'api'`
      // rows to `'private'`; pass it explicitly so the optimistic row lands in
      // 私人 too, instead of flashing in 工作区 and jumping when the server replies.
      const defaultVisibility = activeWorkspaceId ? 'private' : undefined;
      const newPageId = await createNewPage(untitledTitle, defaultVisibility);
      navigate(`/page/${newPageId}`);
    } catch (error) {
      console.error('Failed to create page:', error);
      toast.error('Failed to create page');
    }
  }, [canCreate, createNewPage, tFile, navigate, activeWorkspaceId]);

  /**
   * Create page menu item
   */
  const createPageMenuItem = useCallback(
    (): MenuItem => ({
      icon: <Icon icon={FileTextIcon} />,
      disabled: !canCreate,
      key: 'newPage',
      label: t('newPage'),
      sfSymbol: 'doc.badge.plus',
      onClick: async (info) => {
        info.domEvent?.stopPropagation();
        if (!canCreate) return;

        await createPage();
      },
    }),
    [canCreate, t, createPage],
  );

  /**
   * Top-level create menu shown by the Agent section and header add buttons.
   *
   * Regression example: the Agent section + menu used to expose only local creation actions,
   * so users had no visible entry to `/community/agent`.
   */
  const createTopLevelMenuItems = useCallback((): ItemType[] => {
    const connectItem = createConnectAgentMenuItem();

    return [
      createAgentMenuItem(),
      createGroupChatMenuItem(),
      ...(connectItem ? [{ type: 'divider' as const }, connectItem] : []),
      { type: 'divider' as const },
      createAgentListMenuItem(),
      createMarketAgentMenuItem(),
    ];
  }, [
    createAgentListMenuItem,
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createGroupChatMenuItem,
    createMarketAgentMenuItem,
  ]);

  return {
    configMenuItem,
    createAgent,
    createAgentListMenuItem,
    createAgentMenuItem,
    createConnectAgentMenuItem,
    createEmptyGroup,
    createGroupChatMenuItem,
    createGroupFromTemplate,
    createGroupWithMembers,
    createMarketAgentMenuItem,
    createPage,
    createPageMenuItem,
    createSessionGroupMenuItem,
    createTopLevelMenuItems,
    openCreateModal,

    // Loading states
    isCreatingGroup,
    isCreatingSessionGroup,
    isLoading: isMutatingAgent || isMutatingGroup || isCreatingGroup || isCreatingSessionGroup,
    isMutatingAgent,
  };
};

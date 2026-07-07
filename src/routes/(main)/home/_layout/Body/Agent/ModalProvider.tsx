'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { type ReactNode, useCallback } from 'react';
import { createContext, memo, use, useMemo, useState } from 'react';

import { ChatGroupWizard } from '@/components/ChatGroupWizard';
import { MemberSelectionModal } from '@/components/MemberSelectionModal';
import { openCreatePlatformAgentModal } from '@/features/CreatePlatformAgent';
import EditingPopover from '@/features/EditingPopover';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { CreateAgentModal } from '@/routes/(main)/home/_layout/hooks/useCreateModal';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import ConfigGroupModal from './Modals/ConfigGroupModal';
import CreateGroupModal from './Modals/CreateGroupModal';

interface OpenCreateModalOptions {
  groupId?: string;
  /**
   * Threaded into the create flow so the resulting agent / group lands in the
   * Private bucket of the sidebar. Omitted means "public" — the existing
   * default. Honored by the inner CreateModalRenderer when it calls
   * `storeCreateAgent` (the chat-group path defers to its own
   * publish-to-workspace toggle inside the profile page).
   */
  visibility?: 'private' | 'public';
}

interface AgentModalContextValue {
  closeAllModals: () => void;
  closeConfigGroupModal: () => void;
  closeCreateGroupModal: () => void;
  closeGroupWizardModal: () => void;
  closeMemberSelectionModal: () => void;
  openConfigGroupModal: (scope?: 'private' | 'public') => void;
  openCreateGroupModal: (sessionId: string, visibility?: 'private' | 'public') => void;
  openCreateModal: (type: 'agent' | 'group', options?: OpenCreateModalOptions) => void;
  openCreatePlatformAgentModal: (options?: OpenCreateModalOptions) => void;
  openGroupWizardModal: (callbacks: GroupWizardCallbacks) => void;
  openMemberSelectionModal: (callbacks: MemberSelectionCallbacks) => void;
  setGroupWizardLoading: (loading: boolean) => void;
}

interface GroupWizardCallbacks {
  onCancel?: () => void;
  onCreateCustom?: (selectedAgents: string[]) => Promise<void>;
  onCreateFromTemplate?: (templateId: string, selectedMemberTitles?: string[]) => Promise<void>;
}

interface MemberSelectionCallbacks {
  onCancel?: () => void;
  onConfirm?: (selectedAgents: string[]) => Promise<void>;
}

const AgentModalContext = createContext<AgentModalContextValue | null>(null);

export const useAgentModal = () => {
  const context = use(AgentModalContext);
  if (!context) {
    throw new Error('useAgentModal must be used within AgentModalProvider');
  }
  return context;
};

export const useOptionalAgentModal = () => {
  return use(AgentModalContext);
};

interface CreateModalRendererProps {
  groupId?: string;
  onClose: () => void;
  open: boolean;
  type: 'agent' | 'group';
  visibility?: 'private' | 'public';
}

const CreateModalRenderer = memo<CreateModalRendererProps>(
  ({ open, type, groupId, onClose, visibility }) => {
    const navigate = useWorkspaceAwareNavigate();
    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const storeCreateAgent = useAgentStore((s) => s.createAgent);
    const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
    const sendAsAgent = useHomeStore((s) => s.sendAsAgent);
    const sendAsGroup = useHomeStore((s) => s.sendAsGroup);

    const handleSubmit = useCallback(
      async (prompt: string) => {
        if (type === 'agent') {
          await sendAsAgent({ groupId, message: prompt });
        } else {
          await sendAsGroup({ groupId, message: prompt });
        }
      },
      [type, sendAsAgent, sendAsGroup, groupId],
    );

    const handleCreateBlank = useCallback(async () => {
      if (type === 'agent') {
        const result = await storeCreateAgent({ groupId, visibility });
        useGlobalStore.getState().toggleAgentBuilderPanel(true);
        navigate(`/agent/${result.agentId}/profile`);
        await refreshAgentList();
      } else {
        await sendAsGroup({ groupId, message: '' });
      }
    }, [type, storeCreateAgent, navigate, refreshAgentList, sendAsGroup, groupId, visibility]);

    const handleOpenSkills = useCallback(
      (identifier: string) => {
        onClose();
        navigate(`/settings/skill?tab=skill&skill=${encodeURIComponent(identifier)}`);
      },
      [navigate, onClose],
    );

    const handleTryInLobeAI = useCallback(() => {
      if (!inboxAgentId) return;

      navigate(AGENT_CHAT_URL(inboxAgentId, false));
    }, [inboxAgentId, navigate]);

    return (
      <CreateAgentModal
        agentId={inboxAgentId}
        open={open}
        type={type}
        onClose={onClose}
        onCreateBlank={handleCreateBlank}
        onOpenSkills={handleOpenSkills}
        onSubmit={handleSubmit}
        onTryInLobeAI={handleTryInLobeAI}
      />
    );
  },
);

interface AgentModalProviderProps {
  children: ReactNode;
}

export const AgentModalProvider = memo<AgentModalProviderProps>(({ children }) => {
  // CreateGroupModal state
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [createGroupSessionId, setCreateGroupSessionId] = useState<string>('');
  const [createGroupVisibility, setCreateGroupVisibility] = useState<
    'private' | 'public' | undefined
  >(undefined);

  // ConfigGroupModal state
  const [configGroupModalOpen, setConfigGroupModalOpen] = useState(false);
  const [configGroupModalScope, setConfigGroupModalScope] = useState<'private' | 'public'>(
    'public',
  );

  // GroupWizard state
  const [groupWizardOpen, setGroupWizardOpen] = useState(false);
  const [groupWizardCallbacks, setGroupWizardCallbacks] = useState<GroupWizardCallbacks>({});
  const [groupWizardLoading, setGroupWizardLoading] = useState(false);

  // MemberSelection state
  const [memberSelectionOpen, setMemberSelectionOpen] = useState(false);
  const [memberSelectionCallbacks, setMemberSelectionCallbacks] =
    useState<MemberSelectionCallbacks>({});

  // CreateAgentModal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createModalType, setCreateModalType] = useState<'agent' | 'group'>('agent');
  const [createModalGroupId, setCreateModalGroupId] = useState<string | undefined>(undefined);
  const [createModalVisibility, setCreateModalVisibility] = useState<
    'private' | 'public' | undefined
  >(undefined);

  const contextValue = useMemo<AgentModalContextValue>(
    () => ({
      closeAllModals: () => {
        setCreateGroupModalOpen(false);
        setConfigGroupModalOpen(false);
        setGroupWizardOpen(false);
        setMemberSelectionOpen(false);
        setCreateModalOpen(false);
      },
      closeConfigGroupModal: () => setConfigGroupModalOpen(false),
      closeCreateGroupModal: () => setCreateGroupModalOpen(false),
      closeGroupWizardModal: () => setGroupWizardOpen(false),
      closeMemberSelectionModal: () => setMemberSelectionOpen(false),
      openConfigGroupModal: (scope?: 'private' | 'public') => {
        setConfigGroupModalScope(scope ?? 'public');
        setConfigGroupModalOpen(true);
      },
      openCreateGroupModal: (sessionId: string, visibility?: 'private' | 'public') => {
        setCreateGroupSessionId(sessionId);
        setCreateGroupVisibility(visibility);
        setCreateGroupModalOpen(true);
      },
      openCreateModal: (type: 'agent' | 'group', options?: OpenCreateModalOptions) => {
        setCreateModalType(type);
        setCreateModalGroupId(options?.groupId);
        setCreateModalVisibility(options?.visibility);
        setCreateModalOpen(true);
      },
      openCreatePlatformAgentModal: (options?: OpenCreateModalOptions) => {
        openCreatePlatformAgentModal({
          groupId: options?.groupId,
          visibility: options?.visibility,
        });
      },
      openGroupWizardModal: (callbacks: GroupWizardCallbacks) => {
        setGroupWizardCallbacks(callbacks);
        setGroupWizardOpen(true);
      },
      openMemberSelectionModal: (callbacks: MemberSelectionCallbacks) => {
        setMemberSelectionCallbacks(callbacks);
        setMemberSelectionOpen(true);
      },
      setGroupWizardLoading,
    }),
    [],
  );

  return (
    <AgentModalContext value={contextValue}>
      <CreateModalRenderer
        groupId={createModalGroupId}
        open={createModalOpen}
        type={createModalType}
        visibility={createModalVisibility}
        onClose={() => setCreateModalOpen(false)}
      />
      {children}

      {/* All modals rendered at top level */}
      {createGroupModalOpen && (
        <CreateGroupModal
          id={createGroupSessionId}
          open={createGroupModalOpen}
          visibility={createGroupVisibility}
          onCancel={() => setCreateGroupModalOpen(false)}
        />
      )}

      <ConfigGroupModal
        open={configGroupModalOpen}
        scope={configGroupModalScope}
        onCancel={() => setConfigGroupModalOpen(false)}
      />

      <ChatGroupWizard
        isCreatingFromTemplate={groupWizardLoading}
        open={groupWizardOpen}
        onCancel={() => {
          groupWizardCallbacks.onCancel?.();
          setGroupWizardOpen(false);
        }}
        onCreateCustom={async (selectedAgents: string[]) => {
          await groupWizardCallbacks.onCreateCustom?.(selectedAgents);
        }}
        onCreateFromTemplate={async (templateId: string, selectedMemberTitles?: string[]) => {
          await groupWizardCallbacks.onCreateFromTemplate?.(templateId, selectedMemberTitles);
        }}
      />

      <MemberSelectionModal
        mode="create"
        open={memberSelectionOpen}
        onCancel={() => {
          memberSelectionCallbacks.onCancel?.();
          setMemberSelectionOpen(false);
        }}
        onConfirm={async (selectedAgents: string[]) => {
          await memberSelectionCallbacks.onConfirm?.(selectedAgents);
        }}
      />

      <EditingPopover />
    </AgentModalContext>
  );
});

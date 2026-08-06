'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { type ModalInstance } from '@lobehub/ui/base-ui';
import {
  createContext,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import EditingPopover from '@/features/EditingPopover';
import type { OpenCreateAgentModalOptions } from '@/features/HomeSidebar/hooks/useCreateModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { openLabelFormModal } from '@/features/WorkspaceSetting/Labels/LabelFormModal';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import { useGlobalStore } from '@/store/global';
import { useHomeStore } from '@/store/home';

import ConfigGroupModal from './Modals/ConfigGroupModal';
import { openCreateGroupModal } from './Modals/CreateGroupModal';

const ChatGroupWizard = lazy(() =>
  import('@/components/ChatGroupWizard').then((module) => ({
    default: module.ChatGroupWizard,
  })),
);

const MemberSelectionModal = lazy(() =>
  import('@/components/MemberSelectionModal').then((module) => ({
    default: module.MemberSelectionModal,
  })),
);

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
  openCreateGroupModal: (sessionId?: string, visibility?: 'private' | 'public') => void;
  /**
   * Create an agent label from anywhere in the list (e.g. the Labels
   * submenu). When `assignTo` is given, the new label is applied to that
   * agent right after creation.
   */
  openCreateLabelModal: (assignTo?: { agentId: string; currentLabelIds: string[] }) => void;
  openCreateModal: (type: 'agent' | 'group', options?: OpenCreateModalOptions) => void;
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
  type: 'agent' | 'group';
  visibility?: 'private' | 'public';
}

const CreateModalRenderer = memo<CreateModalRendererProps>(
  ({ type, groupId, onClose, visibility }) => {
    const navigate = useWorkspaceAwareNavigate();
    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const storeCreateAgent = useAgentStore((s) => s.createAgent);
    const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
    const sendAsAgent = useHomeStore((s) => s.sendAsAgent);
    const sendAsGroup = useHomeStore((s) => s.sendAsGroup);

    const handleSubmit = useCallback(
      async (prompt: string) => {
        if (type === 'agent') {
          await sendAsAgent({ groupId, message: prompt, visibility });
        } else {
          await sendAsGroup({ groupId, message: prompt, visibility });
        }
      },
      [type, sendAsAgent, sendAsGroup, groupId, visibility],
    );

    const handleCreateBlank = useCallback(async () => {
      if (type === 'agent') {
        const result = await storeCreateAgent({ groupId, visibility });
        useGlobalStore.getState().toggleAgentBuilderPanel(true);
        navigate(`/agent/${result.agentId}/profile`);
        await refreshAgentList();
      } else {
        await sendAsGroup({ groupId, message: '', visibility });
      }
    }, [type, storeCreateAgent, navigate, refreshAgentList, sendAsGroup, groupId, visibility]);

    const handleOpenSkills = useCallback(
      (identifier: string) => {
        onClose();
        navigate(`/settings/skill?skill=${encodeURIComponent(identifier)}`);
      },
      [navigate, onClose],
    );

    const handleTryInLobeAI = useCallback(() => {
      if (!inboxAgentId) return;

      navigate(AGENT_CHAT_URL(inboxAgentId, false));
    }, [inboxAgentId, navigate]);

    // Mounted only while the modal should be open, so the open/close bridge is
    // just this component's lifetime — the panel itself lives in the ModalHost.
    const openArgsRef = useRef<OpenCreateAgentModalOptions>(undefined);
    openArgsRef.current = {
      agentId: inboxAgentId,
      type,
      onClosed: onClose,
      onCreateBlank: handleCreateBlank,
      onOpenSkills: handleOpenSkills,
      onSubmit: handleSubmit,
      onTryInLobeAI: handleTryInLobeAI,
    };

    useEffect(() => {
      // Imported here rather than at module scope so the create-agent chunk (it
      // pulls in the whole ChatInput stack) still loads only when the modal opens.
      let cancelled = false;
      let instance: ModalInstance | undefined;

      void import('@/features/HomeSidebar/hooks/useCreateModal').then(
        ({ openCreateAgentModal }) => {
          if (cancelled) return;
          instance = openCreateAgentModal(openArgsRef.current!);
        },
      );

      return () => {
        cancelled = true;
        instance?.close();
      };
    }, []);

    return null;
  },
);

interface AgentModalProviderProps {
  children: ReactNode;
}

export const AgentModalProvider = memo<AgentModalProviderProps>(({ children }) => {
  const createGroupModalRef = useRef<ModalInstance>(undefined);

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
        createGroupModalRef.current?.close();
        setConfigGroupModalOpen(false);
        setGroupWizardOpen(false);
        setMemberSelectionOpen(false);
        setCreateModalOpen(false);
      },
      closeConfigGroupModal: () => setConfigGroupModalOpen(false),
      closeCreateGroupModal: () => createGroupModalRef.current?.close(),
      closeGroupWizardModal: () => setGroupWizardOpen(false),
      closeMemberSelectionModal: () => setMemberSelectionOpen(false),
      openConfigGroupModal: (scope?: 'private' | 'public') => {
        setConfigGroupModalScope(scope ?? 'public');
        setConfigGroupModalOpen(true);
      },
      openCreateGroupModal: (sessionId?: string, visibility?: 'private' | 'public') => {
        createGroupModalRef.current = openCreateGroupModal({ id: sessionId, visibility });
      },
      openCreateLabelModal: (assignTo?: { agentId: string; currentLabelIds: string[] }) => {
        openLabelFormModal({ assignTo });
      },
      openCreateModal: (type: 'agent' | 'group', options?: OpenCreateModalOptions) => {
        setCreateModalType(type);
        setCreateModalGroupId(options?.groupId);
        setCreateModalVisibility(options?.visibility);
        setCreateModalOpen(true);
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
      {createModalOpen && (
        <CreateModalRenderer
          groupId={createModalGroupId}
          type={createModalType}
          visibility={createModalVisibility}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
      {children}

      <ConfigGroupModal
        open={configGroupModalOpen}
        scope={configGroupModalScope}
        onCancel={() => setConfigGroupModalOpen(false)}
      />

      {groupWizardOpen && (
        <Suspense fallback={null}>
          <ChatGroupWizard
            open
            isCreatingFromTemplate={groupWizardLoading}
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
        </Suspense>
      )}

      {memberSelectionOpen && (
        <Suspense fallback={null}>
          <MemberSelectionModal
            open
            mode="create"
            onCancel={() => {
              memberSelectionCallbacks.onCancel?.();
              setMemberSelectionOpen(false);
            }}
            onConfirm={async (selectedAgents: string[]) => {
              await memberSelectionCallbacks.onConfirm?.(selectedAgents);
            }}
          />
        </Suspense>
      )}

      <EditingPopover />
    </AgentModalContext>
  );
});

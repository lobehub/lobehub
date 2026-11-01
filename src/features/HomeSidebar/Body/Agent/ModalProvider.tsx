'use client';

import { type ModalInstance } from '@lobehub/ui';
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

import type { OpenCreateAgentIdentityModalOptions } from '@/features/AgentIdentityModal';
import EditingPopover from '@/features/EditingPopover';
import type { OpenCreateAgentModalOptions } from '@/features/HomeSidebar/hooks/useCreateModal';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { openLabelFormModal } from '@/features/WorkspaceSetting/Labels/LabelFormModal';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
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
   * default. The agent form passes it to `createAgent`; the group path
   * forwards it to `sendAsGroup`.
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

interface CreateGroupModalRendererProps {
  groupId?: string;
  onClose: () => void;
  visibility?: 'private' | 'public';
}

/** Groups still start from a prompt: describe the group and the builder assembles it. */
const CreateGroupModalRenderer = memo<CreateGroupModalRendererProps>(
  ({ groupId, onClose, visibility }) => {
    const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
    const sendAsGroup = useHomeStore((s) => s.sendAsGroup);

    const handleSubmit = useCallback(
      async (prompt: string) => {
        await sendAsGroup({ groupId, message: prompt, visibility });
      },
      [sendAsGroup, groupId, visibility],
    );

    const handleCreateBlank = useCallback(async () => {
      await sendAsGroup({ groupId, message: '', visibility });
    }, [sendAsGroup, groupId, visibility]);

    // Mounted only while the modal should be open, so the open/close bridge is
    // just this component's lifetime — the panel itself lives in the ModalHost.
    const openArgsRef = useRef<OpenCreateAgentModalOptions>(undefined);
    openArgsRef.current = {
      agentId: inboxAgentId,
      type: 'group',
      onClosed: onClose,
      onCreateBlank: handleCreateBlank,
      onSubmit: handleSubmit,
    };

    useEffect(() => {
      // Imported here rather than at module scope so the create chunk (it pulls
      // in the whole ChatInput stack) still loads only when the modal opens.
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

interface CreateAgentIdentityRendererProps {
  groupId?: string;
  onClose: () => void;
  visibility?: 'private' | 'public';
}

/**
 * New agents start from the identity form (avatar, name, role, description,
 * slug) and land on their profile page, where the rest is configured.
 */
const CreateAgentIdentityRenderer = memo<CreateAgentIdentityRendererProps>(
  ({ groupId, onClose, visibility }) => {
    const navigate = useWorkspaceAwareNavigate();

    const openArgsRef = useRef<OpenCreateAgentIdentityModalOptions>(undefined);
    openArgsRef.current = {
      groupId,
      onClosed: onClose,
      onCreated: (agentId) => navigate(`/agent/${agentId}/profile`),
      visibility,
    };

    useEffect(() => {
      let cancelled = false;
      let instance: ModalInstance | undefined;

      void import('@/features/AgentIdentityModal').then(({ openCreateAgentIdentityModal }) => {
        if (cancelled) return;
        instance = openCreateAgentIdentityModal(openArgsRef.current!);
      });

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
      {createModalOpen && createModalType === 'agent' && (
        <CreateAgentIdentityRenderer
          groupId={createModalGroupId}
          visibility={createModalVisibility}
          onClose={() => setCreateModalOpen(false)}
        />
      )}
      {createModalOpen && createModalType === 'group' && (
        <CreateGroupModalRenderer
          groupId={createModalGroupId}
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

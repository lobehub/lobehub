'use client';

import { type ReactNode } from 'react';
import { createContext, memo, use, useMemo, useState } from 'react';

import { ChatGroupWizard } from '@/components/ChatGroupWizard';
import { MemberSelectionModal } from '@/components/MemberSelectionModal';

import ConfigGroupModal from './Modals/ConfigGroupModal';
import CreateGroupModal from './Modals/CreateGroupModal';

interface AgentModalContextValue {
  closeAllModals: () => void;
  closeConfigGroupModal: () => void;
  closeCreateGroupModal: () => void;
  closeGroupWizardModal: () => void;
  closeMemberSelectionModal: () => void;
  openConfigGroupModal: () => void;
  openCreateGroupModal: (sessionId: string) => void;
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

interface AgentModalProviderProps {
  children: ReactNode;
}

export const AgentModalProvider = memo<AgentModalProviderProps>(({ children }) => {
  // CreateGroupModal state
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [createGroupSessionId, setCreateGroupSessionId] = useState<string>('');

  // ConfigGroupModal state
  const [configGroupModalOpen, setConfigGroupModalOpen] = useState(false);

  // GroupWizard state
  const [groupWizardOpen, setGroupWizardOpen] = useState(false);
  const [groupWizardCallbacks, setGroupWizardCallbacks] = useState<GroupWizardCallbacks>({});
  const [groupWizardLoading, setGroupWizardLoading] = useState(false);

  // MemberSelection state
  const [memberSelectionOpen, setMemberSelectionOpen] = useState(false);
  const [memberSelectionCallbacks, setMemberSelectionCallbacks] =
    useState<MemberSelectionCallbacks>({});

  const contextValue = useMemo<AgentModalContextValue>(
    () => ({
      closeAllModals: () => {
        setCreateGroupModalOpen(false);
        setConfigGroupModalOpen(false);
        setGroupWizardOpen(false);
        setMemberSelectionOpen(false);
      },
      closeConfigGroupModal: () => setConfigGroupModalOpen(false),
      closeCreateGroupModal: () => setCreateGroupModalOpen(false),
      closeGroupWizardModal: () => setGroupWizardOpen(false),
      closeMemberSelectionModal: () => setMemberSelectionOpen(false),
      openConfigGroupModal: () => setConfigGroupModalOpen(true),
      openCreateGroupModal: (sessionId: string) => {
        setCreateGroupSessionId(sessionId);
        setCreateGroupModalOpen(true);
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
      {children}

      {/* All modals rendered at top level */}
      {createGroupModalOpen && (
        <CreateGroupModal
          id={createGroupSessionId}
          open={createGroupModalOpen}
          onCancel={() => setCreateGroupModalOpen(false)}
        />
      )}

      <ConfigGroupModal
        open={configGroupModalOpen}
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
    </AgentModalContext>
  );
});

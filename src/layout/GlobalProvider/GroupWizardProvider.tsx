'use client';

import { type ReactNode, Suspense, createContext, lazy, memo, useContext, useState } from 'react';

// Lazy load ChatGroupWizard to avoid bundling it globally
const ChatGroupWizard = lazy(() =>
  import('@/components/ChatGroupWizard').then((mod) => ({ default: mod.ChatGroupWizard })),
);

interface GroupWizardCallbacks {
  onCancel?: () => void;
  onCreateCustom?: (
    selectedAgents: string[],
    hostConfig?: { model?: string; provider?: string },
    enableSupervisor?: boolean,
  ) => Promise<void>;
  onCreateFromTemplate?: (
    templateId: string,
    hostConfig?: { model?: string; provider?: string },
    enableSupervisor?: boolean,
    selectedMemberTitles?: string[],
  ) => Promise<void>;
}

interface GroupWizardContextValue {
  closeGroupWizard: () => void;
  openGroupWizard: (callbacks: GroupWizardCallbacks) => void;
}

const GroupWizardContext = createContext<GroupWizardContextValue | null>(null);

export const useGroupWizard = () => {
  const context = useContext(GroupWizardContext);
  if (!context) {
    throw new Error('useGroupWizard must be used within GroupWizardProvider');
  }
  return context;
};

interface GroupWizardProviderProps {
  children: ReactNode;
}

const GroupWizardProviderInner = memo<GroupWizardProviderProps>(({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [callbacks, setCallbacks] = useState<GroupWizardCallbacks>({});
  const [isLoading, setIsLoading] = useState(false);

  const openGroupWizard = (customCallbacks: GroupWizardCallbacks) => {
    setCallbacks(customCallbacks);
    setIsOpen(true);
  };

  const closeGroupWizard = () => {
    setIsOpen(false);
    setIsLoading(false);
  };

  const handleCreateCustom = async (
    selectedAgents: string[],
    hostConfig?: { model?: string; provider?: string },
    enableSupervisor?: boolean,
  ) => {
    if (callbacks.onCreateCustom) {
      await callbacks.onCreateCustom(selectedAgents, hostConfig, enableSupervisor);
      closeGroupWizard();
    }
  };

  const handleCreateFromTemplate = async (
    templateId: string,
    hostConfig?: { model?: string; provider?: string },
    enableSupervisor?: boolean,
    selectedMemberTitles?: string[],
  ) => {
    if (callbacks.onCreateFromTemplate) {
      setIsLoading(true);
      try {
        await callbacks.onCreateFromTemplate(
          templateId,
          hostConfig,
          enableSupervisor,
          selectedMemberTitles,
        );
        closeGroupWizard();
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleCancel = () => {
    callbacks.onCancel?.();
    closeGroupWizard();
  };

  return (
    <GroupWizardContext.Provider value={{ closeGroupWizard, openGroupWizard }}>
      {children}
      <Suspense fallback={null}>
        {isOpen && (
          <ChatGroupWizard
            isCreatingFromTemplate={isLoading}
            onCancel={handleCancel}
            onCreateCustom={handleCreateCustom}
            onCreateFromTemplate={handleCreateFromTemplate}
            open={isOpen}
          />
        )}
      </Suspense>
    </GroupWizardContext.Provider>
  );
});

GroupWizardProviderInner.displayName = 'GroupWizardProviderInner';

export const GroupWizardProvider = GroupWizardProviderInner;

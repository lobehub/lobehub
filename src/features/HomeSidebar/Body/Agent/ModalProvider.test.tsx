import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModalProvider, useAgentModal } from './ModalProvider';

const mocks = vi.hoisted(() => ({
  closeCreateAgentModal: vi.fn(),
  createAgent: vi.fn(),
  createAgentModalProps: undefined as
    | {
        onCreateBlank: () => Promise<void> | void;
        onOpenSkills?: (identifier: string) => void;
      }
    | undefined,
  navigate: vi.fn(),
  refreshAgentList: vi.fn(),
  sendAsAgent: vi.fn(),
  sendAsGroup: vi.fn(),
  toggleAgentBuilderPanel: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/components/ChatGroupWizard', () => ({
  ChatGroupWizard: ({ open }: { open: boolean }) =>
    open ? <div>Deferred group wizard</div> : null,
}));

vi.mock('@/components/MemberSelectionModal', () => ({
  MemberSelectionModal: ({ open }: { open: boolean }) =>
    open ? <div>Deferred member selection</div> : null,
}));

vi.mock('@/features/CreatePlatformAgent', () => ({
  default: () => null,
}));

vi.mock('@/features/EditingPopover', () => ({
  default: () => null,
}));

vi.mock('@/features/HomeSidebar/hooks/useCreateModal', () => ({
  openCreateAgentModal: (props: {
    onCreateBlank: () => Promise<void> | void;
    onOpenSkills?: (identifier: string) => void;
  }) => {
    mocks.createAgentModalProps = props;
    return { close: mocks.closeCreateAgentModal };
  },
}));

vi.mock('@/features/WorkspaceSetting/Labels/LabelFormModal', () => ({
  openLabelFormModal: vi.fn(),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (
    selector: (state: { createAgent: typeof mocks.createAgent; inboxAgentId: string }) => unknown,
  ) =>
    selector({
      createAgent: mocks.createAgent,
      inboxAgentId: 'inbox-agent',
    }),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: (state: { inboxAgentId: string }) => state.inboxAgentId,
  },
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: {
    getState: () => ({
      toggleAgentBuilderPanel: mocks.toggleAgentBuilderPanel,
    }),
  },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (
    selector: (state: {
      refreshAgentList: typeof mocks.refreshAgentList;
      sendAsAgent: typeof mocks.sendAsAgent;
      sendAsGroup: typeof mocks.sendAsGroup;
    }) => unknown,
  ) =>
    selector({
      refreshAgentList: mocks.refreshAgentList,
      sendAsAgent: mocks.sendAsAgent,
      sendAsGroup: mocks.sendAsGroup,
    }),
}));

vi.mock('./Modals/ConfigGroupModal', () => ({
  default: () => null,
}));

vi.mock('./Modals/CreateGroupModal', () => ({
  openCreateGroupModal: vi.fn(),
}));

const OpenCreateAgentModalButton = () => {
  const { openCreateModal, openGroupWizardModal, openMemberSelectionModal } = useAgentModal();

  return (
    <>
      <button type="button" onClick={() => openCreateModal('agent')}>
        Open create agent modal
      </button>
      <button type="button" onClick={() => openGroupWizardModal({})}>
        Open group wizard
      </button>
      <button type="button" onClick={() => openMemberSelectionModal({})}>
        Open member selection
      </button>
    </>
  );
};

const renderProvider = () =>
  render(
    <AgentModalProvider>
      <OpenCreateAgentModalButton />
    </AgentModalProvider>,
  );

describe('AgentModalProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAgentModalProps = undefined;
    mocks.createAgent.mockResolvedValue({ agentId: 'agent-new' });
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the Agent Builder panel after creating a blank agent', async () => {
    renderProvider();

    fireEvent.click(screen.getByText('Open create agent modal'));
    await waitFor(() => expect(mocks.createAgentModalProps).toBeDefined());
    await mocks.createAgentModalProps!.onCreateBlank();

    await waitFor(() => {
      expect(mocks.createAgent).toHaveBeenCalledWith({ groupId: undefined });
      expect(mocks.toggleAgentBuilderPanel).toHaveBeenCalledWith(true);
      expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-new/profile');
      expect(mocks.refreshAgentList).toHaveBeenCalled();
    });
  });

  it('opens the Skills tab from the create modal skill completion state', async () => {
    renderProvider();

    fireEvent.click(screen.getByText('Open create agent modal'));
    await waitFor(() => expect(mocks.createAgentModalProps).toBeDefined());
    mocks.createAgentModalProps!.onOpenSkills?.('product-requirements-writer');

    expect(mocks.navigate).toHaveBeenCalledWith(
      '/settings/skill?skill=product-requirements-writer',
    );
  });

  it('loads deferred selection modals when their interactions request them', async () => {
    renderProvider();

    expect(screen.queryByText('Deferred group wizard')).not.toBeInTheDocument();
    expect(screen.queryByText('Deferred member selection')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Open group wizard'));
    expect(await screen.findByText('Deferred group wizard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Open member selection'));
    expect(await screen.findByText('Deferred member selection')).toBeInTheDocument();
  });
});

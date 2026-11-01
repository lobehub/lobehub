import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModalProvider, useAgentModal } from './ModalProvider';

const mocks = vi.hoisted(() => ({
  closeCreateAgentModal: vi.fn(),
  createAgentModalProps: undefined as
    | {
        onCreateBlank: () => Promise<void> | void;
        onSubmit: (prompt: string) => Promise<void> | void;
        type: 'agent' | 'group';
      }
    | undefined,
  identityModalProps: undefined as
    | {
        groupId?: string;
        onCreated: (agentId: string) => void;
        visibility?: 'private' | 'public';
      }
    | undefined,
  navigate: vi.fn(),
  sendAsGroup: vi.fn(),
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
  openCreateAgentModal: (props: NonNullable<typeof mocks.createAgentModalProps>) => {
    mocks.createAgentModalProps = props;
    return { close: mocks.closeCreateAgentModal };
  },
}));

vi.mock('@/features/AgentIdentityModal', () => ({
  openCreateAgentIdentityModal: (props: NonNullable<typeof mocks.identityModalProps>) => {
    mocks.identityModalProps = props;
    return { close: vi.fn() };
  },
}));

vi.mock('@/features/WorkspaceSetting/Labels/LabelFormModal', () => ({
  openLabelFormModal: vi.fn(),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: { inboxAgentId: string }) => unknown) =>
    selector({ inboxAgentId: 'inbox-agent' }),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: (state: { inboxAgentId: string }) => state.inboxAgentId,
  },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: { sendAsGroup: typeof mocks.sendAsGroup }) => unknown) =>
    selector({ sendAsGroup: mocks.sendAsGroup }),
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
      <button
        type="button"
        onClick={() => openCreateModal('agent', { groupId: 'grp', visibility: 'private' })}
      >
        Open create agent modal
      </button>
      <button type="button" onClick={() => openCreateModal('group')}>
        Open create group modal
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
    mocks.identityModalProps = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('creates an agent from the identity form and opens its profile', async () => {
    renderProvider();

    fireEvent.click(screen.getByText('Open create agent modal'));
    await waitFor(() => expect(mocks.identityModalProps).toBeDefined());

    expect(mocks.identityModalProps).toMatchObject({ groupId: 'grp', visibility: 'private' });
    // The prompt-based modal is no longer part of agent creation.
    expect(mocks.createAgentModalProps).toBeUndefined();

    mocks.identityModalProps!.onCreated('agent-new');
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agent-new/profile');
  });

  it('keeps the prompt modal for groups', async () => {
    renderProvider();

    fireEvent.click(screen.getByText('Open create group modal'));
    await waitFor(() => expect(mocks.createAgentModalProps).toBeDefined());

    expect(mocks.createAgentModalProps!.type).toBe('group');
    expect(mocks.identityModalProps).toBeUndefined();

    await mocks.createAgentModalProps!.onSubmit('Plan a launch');
    expect(mocks.sendAsGroup).toHaveBeenCalledWith({
      groupId: undefined,
      message: 'Plan a launch',
      visibility: undefined,
    });
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

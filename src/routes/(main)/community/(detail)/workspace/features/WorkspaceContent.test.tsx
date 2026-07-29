// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { type WorkspaceDetailContextConfig, WorkspaceDetailProvider } from './DetailProvider';
import WorkspaceContent from './WorkspaceContent';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../user/features/useUserDetail', () => ({
  useUserDetail: () => ({ handleStatusChange: vi.fn() }),
}));

vi.mock('./WorkspaceAgentList', () => ({
  default: () => <div>Created Agents</div>,
}));

vi.mock('./WorkspaceGroupList', () => ({
  default: () => <div>Agent Groups</div>,
}));

vi.mock('./WorkspacePluginList', () => ({
  default: () => <div>MCP</div>,
}));

const createConfig = (
  overrides: Partial<WorkspaceDetailContextConfig> = {},
): WorkspaceDetailContextConfig => ({
  agentCount: 0,
  agents: [],
  canEdit: true,
  groupCount: 0,
  onEditWorkspaceProfile: vi.fn(),
  totalInstalls: 0,
  user: {
    avatarUrl: null,
    bannerUrl: null,
    createdAt: '',
    description: null,
    displayName: 'Acme',
    id: 0,
    namespace: '',
    socialLinks: null,
    type: 'organization',
    userName: null,
  },
  ...overrides,
});

describe('WorkspaceContent', () => {
  it('shows setup guidance instead of published resource sections before setup', () => {
    render(
      <WorkspaceDetailProvider config={createConfig()}>
        <WorkspaceContent />
      </WorkspaceDetailProvider>,
    );

    expect(screen.getByText('user.workspaceProfile.setup.empty.title')).toBeInTheDocument();
    expect(screen.queryByText('Created Agents')).not.toBeInTheDocument();
    expect(screen.queryByText('MCP')).not.toBeInTheDocument();
  });

  it('opens setup from the empty state action', () => {
    const onEditWorkspaceProfile = vi.fn();

    render(
      <WorkspaceDetailProvider config={createConfig({ onEditWorkspaceProfile })}>
        <WorkspaceContent />
      </WorkspaceDetailProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'user.workspaceProfile.setup.save' }));

    expect(onEditWorkspaceProfile).toHaveBeenCalledOnce();
  });

  it('shows a skeleton instead of the setup empty-state while the profile is loading', () => {
    render(
      <WorkspaceDetailProvider config={createConfig({ isLoading: true })}>
        <WorkspaceContent />
      </WorkspaceDetailProvider>,
    );

    expect(screen.queryByText('user.workspaceProfile.setup.empty.title')).not.toBeInTheDocument();
  });

  it('renders resource sections after setup', () => {
    render(
      <WorkspaceDetailProvider
        config={createConfig({
          user: {
            ...createConfig().user,
            namespace: 'acme-labs',
          },
        })}
      >
        <WorkspaceContent />
      </WorkspaceDetailProvider>,
    );

    expect(screen.getByText('Created Agents')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
  });
});

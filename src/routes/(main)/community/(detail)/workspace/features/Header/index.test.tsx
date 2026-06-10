// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type WorkspaceDetailContextConfig, WorkspaceDetailProvider } from '../DetailProvider';
import WorkspaceHeader from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./Banner', () => ({
  default: () => <div data-testid="workspace-banner" />,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const createConfig = (
  overrides: Partial<WorkspaceDetailContextConfig> = {},
): WorkspaceDetailContextConfig => ({
  agentCount: 0,
  agents: [],
  canEdit: false,
  groupCount: 0,
  totalInstalls: 0,
  user: {
    avatarUrl: null,
    bannerUrl: null,
    createdAt: '',
    description: null,
    displayName: 'dsdk',
    id: 0,
    namespace: '',
    socialLinks: null,
    type: 'organization',
    userName: null,
  },
  ...overrides,
});

describe('WorkspaceHeader', () => {
  it('does not render a workspace handle before the Market namespace exists', () => {
    render(
      <WorkspaceDetailProvider config={createConfig({ onEditWorkspaceProfile: vi.fn() })}>
        <WorkspaceHeader />
      </WorkspaceDetailProvider>,
    );

    expect(screen.getByRole('heading', { name: 'dsdk' })).toBeInTheDocument();
    expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'user.setupWorkspaceProfile' })).toBeInTheDocument();
  });

  it('does not render the setup button while the profile is loading', () => {
    render(
      <WorkspaceDetailProvider
        config={createConfig({ isLoading: true, onEditWorkspaceProfile: vi.fn() })}
      >
        <WorkspaceHeader />
      </WorkspaceDetailProvider>,
    );

    expect(
      screen.queryByRole('button', { name: 'user.setupWorkspaceProfile' }),
    ).not.toBeInTheDocument();
  });

  it('renders the organization handle when the Market namespace exists', () => {
    render(
      <WorkspaceDetailProvider
        config={createConfig({
          user: {
            ...createConfig().user,
            namespace: 'org-7k3p9xq2m4',
          },
        })}
      >
        <WorkspaceHeader />
      </WorkspaceDetailProvider>,
    );

    expect(screen.getByText('@org-7k3p9xq2m4')).toBeInTheDocument();
  });

  it('opens the public organization profile in a new tab after setup', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <WorkspaceDetailProvider
        config={createConfig({
          onEditWorkspaceProfile: vi.fn(),
          user: {
            ...createConfig().user,
            namespace: 'acme-labs',
          },
        })}
      >
        <WorkspaceHeader />
      </WorkspaceDetailProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'user.openWorkspacePublicProfile' }));

    expect(open).toHaveBeenCalledWith('/community/org/acme-labs', '_blank', 'noopener,noreferrer');
  });
});

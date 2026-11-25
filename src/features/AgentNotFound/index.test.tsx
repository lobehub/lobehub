import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentNotFound } from './index';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  workspaceId: 'ws-1' as string | undefined,
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.workspaceId,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

describe('AgentNotFound', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workspaceId = 'ws-1';
  });

  it('explains private access in a workspace and leads to the agent list instead of retrying', () => {
    render(<AgentNotFound showAgentList />);

    expect(screen.getByText('agentNotFound.title')).toBeInTheDocument();
    expect(screen.getByText('agentNotFound.desc')).toBeInTheDocument();
    expect(screen.queryByText('notFound.check')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry|notFound.backHome/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'agentNotFound.viewAgents' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/agents');
  });

  it('uses the personal copy and no navigation for hosts that must stay put', () => {
    mocks.workspaceId = undefined;
    render(<AgentNotFound />);

    expect(screen.getByText('agentNotFound.descPersonal')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

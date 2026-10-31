/**
 * @vitest-environment happy-dom
 */
import type { SidebarAgentItem } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AgentCard from './AgentCard';

const workspace = vi.hoisted(() => ({ id: null as string | null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspace.id,
}));
vi.mock('@/features/Workspace/WorkspaceLink', () => ({
  default: ({ children }: { children: ReactNode }) => <a href={'#'}>{children}</a>,
}));
vi.mock('./SidebarItemAvatar', () => ({ default: () => <span /> }));
vi.mock('./ItemActions', () => ({ default: () => null }));
vi.mock('./useAgentCoverColor', () => ({ useAgentCoverColor: () => undefined }));
vi.mock('./AgentLikeButton', () => ({
  default: ({ agentId, workspaceId }: { agentId: string; workspaceId: string }) => (
    <span data-testid={'like'}>{`${workspaceId}/${agentId}`}</span>
  ),
}));

const agent = {
  id: 'agt_neko',
  pinned: false,
  title: 'Side Neko',
  type: 'agent',
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} as unknown as SidebarAgentItem;

describe('AgentCard like slot', () => {
  beforeEach(() => {
    workspace.id = 'ws_1';
  });

  it('shows the heart on a shared workspace agent', () => {
    render(<AgentCard item={agent} />);
    expect(screen.getByTestId('like').textContent).toBe('ws_1/agt_neko');
  });

  it('hides the heart in personal space, on groups and on private agents', () => {
    workspace.id = null;
    const { rerender } = render(<AgentCard item={agent} />);
    expect(screen.queryByTestId('like')).toBeNull();

    workspace.id = 'ws_1';
    rerender(<AgentCard item={{ ...agent, type: 'group' } as SidebarAgentItem} />);
    expect(screen.queryByTestId('like')).toBeNull();

    rerender(<AgentCard item={{ ...agent, visibility: 'private' } as SidebarAgentItem} />);
    expect(screen.queryByTestId('like')).toBeNull();
  });
});

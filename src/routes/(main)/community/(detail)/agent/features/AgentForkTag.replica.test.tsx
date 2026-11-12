/**
 * @vitest-environment happy-dom
 *
 * The community agent's "Forked from" tag reads the fork source replica
 * persisted to IndexedDB, shared with the agent profile header: a reload
 * paints the last confirmed source before the network answers.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { marketApiService } from '@/services/marketApi';
import {
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';

import AgentForkTag from './AgentForkTag';

const detail = vi.hoisted(() => ({
  current: { forkedFromAgentId: 7 as number | undefined, identifier: 'forked-agent' },
}));

vi.mock('./DetailProvider', () => ({ useDetailContext: () => detail.current }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

describe('community AgentForkTag', () => {
  const { persist } = useReplicaHarness('community-fork');

  it('paints the persisted fork source before the network answers', async () => {
    detail.current = { forkedFromAgentId: 7, identifier: 'forked-agent' };
    await persist('discoverAgentForkSource', 'forked-agent', {
      source: { identifier: 'origin-agent', name: 'Origin Agent' },
    });
    vi.spyOn(marketApiService, 'getAgentForkSource').mockImplementation(pending);

    render(<AgentForkTag />, { wrapper });

    expect(await screen.findByText(/Origin Agent/)).toBeInTheDocument();
  });

  it('does not ask for a fork source of an agent that is not a fork', async () => {
    detail.current = { forkedFromAgentId: undefined, identifier: 'plain-agent' };
    const getAgentForkSource = vi.spyOn(marketApiService, 'getAgentForkSource');

    render(<AgentForkTag />, { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getAgentForkSource).not.toHaveBeenCalled();
  });
});

/**
 * @vitest-environment happy-dom
 *
 * The group profile's review and fork tags read Market replicas persisted to
 * IndexedDB: a reload paints the last confirmed tags before the network
 * answers, then the server answer replaces them.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { marketApiService } from '@/services/marketApi';
import {
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';

import GroupForkTag from './GroupForkTag';
import GroupVersionReviewTag from './GroupVersionReviewTag';

vi.mock('react-router', () => ({ useParams: () => ({ gid: 'group-1' }) }));
vi.mock('@/store/agentGroup', () => ({
  useAgentGroupStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agentGroup/selectors', () => ({
  agentGroupSelectors: { getGroupMeta: () => () => ({ marketIdentifier: 'my-group' }) },
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

const Tags = () => (
  <>
    <GroupVersionReviewTag />
    <GroupForkTag />
  </>
);

describe('group profile market tags', () => {
  const { persist } = useReplicaHarness('group-tags');

  it('paints the persisted review and fork tags before the network answers', async () => {
    await persist('discoverMarketAgentGroupStatus', 'my-group', {
      latestVersionUnderReview: true,
    });
    await persist('discoverAgentGroupForkSource', 'my-group', {
      source: { identifier: 'origin-group', name: 'Origin Group' },
    });
    vi.spyOn(marketApiService, 'getAgentGroupDetail').mockImplementation(pending);
    vi.spyOn(marketApiService, 'getAgentGroupForkSource').mockImplementation(pending);

    render(<Tags />, { wrapper });

    expect(await screen.findByText('Under Review')).toBeInTheDocument();
    expect(await screen.findByText(/Origin Group/)).toBeInTheDocument();
  });

  it('replaces the persisted review state with the server answer', async () => {
    await persist('discoverMarketAgentGroupStatus', 'my-group', {
      latestVersionUnderReview: true,
    });
    let answer!: (value: unknown) => void;
    vi.spyOn(marketApiService, 'getAgentGroupDetail').mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );
    vi.spyOn(marketApiService, 'getAgentGroupForkSource').mockResolvedValue({ source: null });

    render(<Tags />, { wrapper });
    expect(await screen.findByText('Under Review')).toBeInTheDocument();

    await act(async () => answer({ versions: [{ isValidated: true }] }));
    await vi.waitFor(() => expect(screen.queryByText('Under Review')).not.toBeInTheDocument());
  });
});

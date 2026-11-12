/**
 * @vitest-environment happy-dom
 *
 * The status, review and fork tags of the agent profile header read one Market
 * status replica persisted to IndexedDB: a reload paints the last confirmed
 * tags before the network answers, and the header sends one detail request
 * however many tags read it.
 *
 * Rows are seeded through the storage namespace (`replica:<name>:v1`) and the
 * tags are rendered as the header renders them.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketApiService } from '@/services/marketApi';
import { useDiscoverStore } from '@/store/discover';
import {
  pending,
  replicaWrapper as wrapper,
  storageOf,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';

import AgentForkTag from './AgentForkTag';
import AgentVersionReviewTag from './AgentVersionReviewTag';

const meta = vi.hoisted(() => ({ current: { marketIdentifier: 'my-agent' } }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentMeta: () => meta.current },
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

const Tags = () => (
  <>
    <AgentVersionReviewTag />
    <AgentForkTag />
  </>
);

const detail = (status: string, extra: Record<string, unknown> = {}) =>
  ({ identifier: 'my-agent', status, versions: [{ isValidated: true }], ...extra }) as never;

describe('agent profile market tags', () => {
  const harness = useReplicaHarness('market-tags');
  const { persist } = harness;

  beforeEach(() => {
    meta.current = { marketIdentifier: 'my-agent' };
  });

  it('paints the persisted status and fork tags before the network answers', async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', {
      forkedFromAgentId: '7',
      latestVersionUnderReview: false,
      status: 'published',
    });
    await persist('discoverAgentForkSource', 'my-agent', {
      source: { identifier: 'origin-agent', name: 'Origin Agent' },
    });
    vi.spyOn(marketApiService, 'getAgentDetail').mockImplementation(pending);
    vi.spyOn(marketApiService, 'getAgentForkSource').mockImplementation(pending);

    render(<Tags />, { wrapper });

    expect(await screen.findByText('Published')).toBeInTheDocument();
    expect(await screen.findByText(/Origin Agent/)).toBeInTheDocument();
  });

  it('replaces the persisted status with the server answer', async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', {
      forkedFromAgentId: null,
      latestVersionUnderReview: false,
      status: 'published',
    });
    let answer!: (value: never) => void;
    vi.spyOn(marketApiService, 'getAgentDetail').mockImplementation(
      () => new Promise((resolve) => (answer = resolve)),
    );

    render(<Tags />, { wrapper });
    expect(await screen.findByText('Published')).toBeInTheDocument();

    await act(async () => answer(detail('archived')));
    expect(await screen.findByText('Archived')).toBeInTheDocument();
  });

  it('sends one detail request for the status, review and fork tags', async () => {
    const getAgentDetail = vi
      .spyOn(marketApiService, 'getAgentDetail')
      .mockResolvedValue(detail('unpublished', { versions: [{ isValidated: false }] }));
    vi.spyOn(marketApiService, 'getAgentForkSource').mockImplementation(pending);

    render(<Tags />, { wrapper });

    expect(await screen.findByText('Under Review')).toBeInTheDocument();
    expect(getAgentDetail).toHaveBeenCalledTimes(1);
  });

  it('asks for the fork source only once the agent is known to be a fork', async () => {
    vi.spyOn(marketApiService, 'getAgentDetail').mockResolvedValue(detail('published'));
    const getAgentForkSource = vi.spyOn(marketApiService, 'getAgentForkSource');

    render(<Tags />, { wrapper });

    expect(await screen.findByText('Published')).toBeInTheDocument();
    expect(getAgentForkSource).not.toHaveBeenCalled();
  });

  it('keeps the last status on screen when a refresh fails', async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', {
      forkedFromAgentId: null,
      latestVersionUnderReview: false,
      status: 'published',
    });
    vi.spyOn(marketApiService, 'getAgentDetail').mockRejectedValue(new Error('network down'));

    render(<Tags />, { wrapper });

    expect(await screen.findByText('Published')).toBeInTheDocument();
    await waitFor(() =>
      expect(useDiscoverStore.getState().marketAgentStatusReplica.entries['my-agent']).toBeTruthy(),
    );
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it("never paints another identity's status", async () => {
    await persist(
      'discoverMarketAgentStatus',
      'my-agent',
      { forkedFromAgentId: null, latestVersionUnderReview: false, status: 'published' },
      `${harness.scope}-other`,
    );
    vi.spyOn(marketApiService, 'getAgentDetail').mockImplementation(pending);

    render(<Tags />, { wrapper });

    await waitFor(() =>
      expect(useDiscoverStore.getState().marketAgentStatusReplica.scope).toBe(harness.scope),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Published')).not.toBeInTheDocument();
  });

  it('drops the persisted status when the Market no longer has the agent', async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', {
      forkedFromAgentId: null,
      latestVersionUnderReview: false,
      status: 'published',
    });
    vi.spyOn(marketApiService, 'getAgentDetail').mockRejectedValue({
      data: { code: 'NOT_FOUND' },
    });

    render(<Tags />, { wrapper });

    await waitFor(() => expect(screen.queryByText('Published')).not.toBeInTheDocument());
    await waitFor(async () =>
      expect(
        await storageOf('discoverMarketAgentStatus').get({
          queryKey: 'my-agent',
          scope: harness.scope,
        }),
      ).toBeUndefined(),
    );
  });
});

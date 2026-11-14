/**
 * @vitest-environment happy-dom
 *
 * The status, review and fork tags of the agent profile header read one Market
 * status replica persisted to IndexedDB: a reload paints the last confirmed
 * tags before the network answers, and the header sends one detail request
 * however many tags read it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { marketApiService } from '@/services/marketApi';
import { useDiscoverStore } from '@/store/discover';
import {
  deferred,
  pending,
  replicaWrapper as wrapper,
  useReplicaHarness,
} from '@/store/discover/__tests__/replicaHarness';

import { useAgentMarketTags } from './useAgentMarketTags';

const meta = vi.hoisted(() => ({ current: { marketIdentifier: 'my-agent' } }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: { currentAgentMeta: () => meta.current },
}));

const detail = (status: string, extra: Record<string, unknown> = {}) =>
  ({ identifier: 'my-agent', status, versions: [{ isValidated: true }], ...extra }) as never;

const PUBLISHED = { forkedFromAgentId: null, latestVersionUnderReview: false, status: 'published' };

describe('useAgentMarketTags', () => {
  const harness = useReplicaHarness('agent-market-tags');
  const { persist } = harness;

  beforeEach(() => {
    meta.current = { marketIdentifier: 'my-agent' };
  });

  it('paints the persisted status and fork source before the network answers', async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', {
      ...PUBLISHED,
      forkedFromAgentId: '7',
    });
    await persist('discoverAgentForkSource', 'my-agent', {
      source: { identifier: 'origin-agent', name: 'Origin Agent' },
    });
    vi.spyOn(marketApiService, 'getAgentDetail').mockImplementation(pending);
    vi.spyOn(marketApiService, 'getAgentForkSource').mockImplementation(pending);

    const { result } = renderHook(() => useAgentMarketTags(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('published'));
    await waitFor(() => expect(result.current.forkSource?.name).toBe('Origin Agent'));
  });

  it('replaces the persisted status with the server answer', async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', PUBLISHED);
    const next = deferred<never>();
    vi.spyOn(marketApiService, 'getAgentDetail').mockImplementation(() => next.promise);

    const { result } = renderHook(() => useAgentMarketTags(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('published'));

    await act(async () => next.resolve(detail('archived')));
    await waitFor(() => expect(result.current.status).toBe('archived'));
  });

  it('sends one detail request for the status, review and fork tags', async () => {
    const getAgentDetail = vi
      .spyOn(marketApiService, 'getAgentDetail')
      .mockResolvedValue(detail('unpublished', { versions: [{ isValidated: false }] }));

    const { result } = renderHook(
      () => [useAgentMarketTags(), useAgentMarketTags(), useAgentMarketTags()],
      { wrapper },
    );

    await waitFor(() => expect(result.current[2].isUnderReview).toBe(true));
    expect(getAgentDetail).toHaveBeenCalledTimes(1);
  });

  it('asks for the fork source only once the agent is known to be a fork', async () => {
    vi.spyOn(marketApiService, 'getAgentDetail').mockResolvedValue(detail('published'));
    const getAgentForkSource = vi.spyOn(marketApiService, 'getAgentForkSource');

    const { result } = renderHook(() => useAgentMarketTags(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('published'));
    expect(getAgentForkSource).not.toHaveBeenCalled();
  });

  it('keeps the last status when a refresh fails', async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', PUBLISHED);
    const getAgentDetail = vi
      .spyOn(marketApiService, 'getAgentDetail')
      .mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAgentMarketTags(), { wrapper });

    await waitFor(() => expect(getAgentDetail).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.status).toBe('published');
  });

  it("never paints another identity's status", async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', PUBLISHED, `${harness.scope}-other`);
    vi.spyOn(marketApiService, 'getAgentDetail').mockImplementation(pending);

    const { result } = renderHook(() => useAgentMarketTags(), { wrapper });

    await waitFor(() =>
      expect(useDiscoverStore.getState().marketAgentStatusReplica.scope).toBe(harness.scope),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.status).toBeNull();
  });

  it('drops the persisted status when the Market no longer has the agent', async () => {
    await persist('discoverMarketAgentStatus', 'my-agent', PUBLISHED);
    vi.spyOn(marketApiService, 'getAgentDetail').mockRejectedValue({
      data: { code: 'NOT_FOUND' },
    });

    const { result } = renderHook(() => useAgentMarketTags(), { wrapper });

    await waitFor(() => expect(result.current.status).toBeNull());
    await waitFor(async () =>
      expect(await harness.stored('discoverMarketAgentStatus', 'my-agent')).toBeUndefined(),
    );
  });
});

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import * as appScope from '@/libs/swr/useCacheScope';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { withSWR } from '~test-utils';

beforeEach(() => {
  const scope = crypto.randomUUID();
  vi.spyOn(cacheScope, 'get').mockReturnValue(scope);
  vi.spyOn(cacheScope, 'use').mockReturnValue(scope);
  vi.spyOn(appScope, 'getCacheScope').mockReturnValue(scope);
  vi.spyOn(appScope, 'useCacheScope').mockReturnValue(scope);
  useAgentStore.setState({
    agentMap: {},
    agentNotFoundMap: {},
    agentConfigReplica: createReplicaState(),
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Confirmed Agent deletion', () => {
  it('settles a server NOT_FOUND response as unavailable instead of a retryable load error', async () => {
    const error = Object.assign(new Error('Agent not found'), { data: { code: 'NOT_FOUND' } });
    vi.spyOn(agentService, 'getAgentConfigById').mockRejectedValue(error);
    await useAgentStore.getState().prefetchAgentConfig('agt_deleted');
    expect(useAgentStore.getState().agentNotFoundMap.agt_deleted).toBe(true);
    expect(useAgentStore.getState().agentConfigErrorMap.agt_deleted).toBeUndefined();
  });

  it('evicts the cached profile and settles the not-found guard before navigating to an old link', async () => {
    vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue({
      id: 'gone',
      name: 'Cached author',
    } as never);
    await useAgentStore.getState().prefetchAgentConfig('gone');
    expect(useAgentStore.getState().agentMap.gone).toBeDefined();

    useAgentStore.getState().markAgentDeleted('gone');

    expect(useAgentStore.getState().agentMap.gone).toBeUndefined();
    expect(useAgentStore.getState().agentNotFoundMap.gone).toBe(true);
  });

  it('allows a restored Agent to be hydrated again', async () => {
    vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(null as never);
    const { unmount } = renderHook(
      () => useAgentStore.getState().useHydrateAgentConfig(true, 'restored'),
      { wrapper: withSWR },
    );
    await waitFor(() => expect(useAgentStore.getState().agentNotFoundMap.restored).toBe(true));
    unmount();
    vi.mocked(agentService.getAgentConfigById).mockResolvedValue({
      id: 'restored',
      name: 'Restored author',
    } as never);
    renderHook(() => useAgentStore.getState().useHydrateAgentConfig(true, 'restored'), {
      wrapper: withSWR,
    });
    await waitFor(() => expect(useAgentStore.getState().agentNotFoundMap.restored).toBeUndefined());
    expect(useAgentStore.getState().agentMap.restored?.name).toBe('Restored author');
  });
});

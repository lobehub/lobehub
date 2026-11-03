import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CacheScopeModule from '@/libs/swr/useCacheScope';
import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';

import { useInitAgentConfig } from './useInitAgentConfig';

const scope = vi.hoisted(() => ({ current: 'user-1:workspace-a' }));

vi.mock('@/libs/swr/useCacheScope', async (importOriginal) => ({
  ...(await importOriginal<typeof CacheScopeModule>()),
  useCacheScope: () => scope.current,
}));
vi.mock('react-router', () => ({ useParams: () => ({}) }));

describe('useInitAgentConfig', () => {
  beforeEach(() => {
    scope.current = 'user-1:workspace-a';
    useUserStore.setState({ isSignedIn: true } as any);
    act(() => {
      useAgentStore.setState({
        agentConfigReplica: { entries: {}, scope: 'user-1:workspace-a' },
        agentMap: { 'agent-1': { title: 'From workspace A' } },
        useFetchAgentConfig: (() => ({ isLoading: true })) as any,
      });
    });
  });

  it('lets a config cached for the active scope stand in while loading', () => {
    const { result } = renderHook(() => useInitAgentConfig('agent-1'));

    expect(result.current.isLoading).toBe(false);
  });

  it('keeps loading when the cached config belongs to the previous workspace', () => {
    scope.current = 'user-1:workspace-b';

    const { result } = renderHook(() => useInitAgentConfig('agent-1'));

    expect(result.current.isLoading).toBe(true);
  });
});

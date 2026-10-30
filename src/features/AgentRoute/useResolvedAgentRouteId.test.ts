/**
 * @vitest-environment happy-dom
 */
import { randomUUID } from 'node:crypto';

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppIndexedDBStorage, cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentService } from '@/services/agent';
import { useAgentStore } from '@/store/agent';
import { initialAgentSliceState } from '@/store/agent/slices/agent/initialState';

import { resolveInboxAgentRouteId, useResolvedAgentRouteId } from './useResolvedAgentRouteId';

describe('resolveInboxAgentRouteId', () => {
  it('should use the stable inbox slug while the persisted agent ID is loading', () => {
    expect(resolveInboxAgentRouteId()).toBe(BUILTIN_AGENT_SLUGS.inbox);
  });

  it('should use the persisted agent ID after initialization', () => {
    expect(resolveInboxAgentRouteId('inbox-agent-id')).toBe('inbox-agent-id');
  });
});

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { dedupingInterval: 0, provider: () => new Map() } },
    createElement(MutateBridge),
    children,
  );

/** The rows the slug lookup replica reads (`replica:<name>:v<version>`). */
const slugStorage = new AppIndexedDBStorage<string>({
  namespace: 'replica:agentSlugId:v1',
});

describe('useResolvedAgentRouteId with a user-chosen slug', () => {
  let scope = '';

  beforeEach(() => {
    scope = `slug-route-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useAgentStore.setState(initialAgentSliceState));
  });

  afterEach(async () => {
    cleanup();
    await slugStorage.remove({ queryKey: 'my-writer', scope });
    vi.restoreAllMocks();
  });

  // `/agent/<slug>` used to render nothing of the agent until the lookup answered.
  it('shows the agent from the local copy, and redirects only once the server confirms', async () => {
    await slugStorage.set({ queryKey: 'my-writer', scope }, { data: 'agt_writer', updatedAt: 1 });
    let resolveLookup!: (value: string | null) => void;
    vi.spyOn(agentService, 'resolveAgentIdBySlug').mockImplementation(
      () => new Promise((resolve) => (resolveLookup = resolve)),
    );

    const { result } = renderHook(() => useResolvedAgentRouteId('my-writer'), { wrapper });

    await waitFor(() => expect(result.current.agentId).toBe('agt_writer'));
    expect(result.current.isSlugRoute).toBe(true);
    // The slug may name another agent by now: no redirect on the local copy alone.
    expect(result.current.resolvedAgentId).toBeUndefined();

    await act(async () => resolveLookup('agt_writer'));

    await waitFor(() => expect(result.current.resolvedAgentId).toBe('agt_writer'));
    expect(result.current.agentId).toBe('agt_writer');
  });

  it('switches to the agent the server names when the slug moved', async () => {
    await slugStorage.set({ queryKey: 'my-writer', scope }, { data: 'agt_old', updatedAt: 1 });
    vi.spyOn(agentService, 'resolveAgentIdBySlug').mockResolvedValue('agt_new');

    const { result } = renderHook(() => useResolvedAgentRouteId('my-writer'), { wrapper });

    await waitFor(() => expect(result.current.resolvedAgentId).toBe('agt_new'));
    expect(result.current.agentId).toBe('agt_new');
  });

  it('never looks up an ordinary agent id', () => {
    const lookup = vi.spyOn(agentService, 'resolveAgentIdBySlug');

    const { result } = renderHook(() => useResolvedAgentRouteId('agt_plain'), { wrapper });

    expect(result.current.agentId).toBe('agt_plain');
    expect(result.current.isSlugRoute).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });
});

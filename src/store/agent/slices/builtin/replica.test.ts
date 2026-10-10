/**
 * @vitest-environment happy-dom
 *
 * The builtin agents (inbox, page-agent, the builders, …) are a replica: the
 * first frame paints the persisted slug → id mapping and config, the network
 * only confirms, a scope switch drops the previous identity before the next
 * paints, and the imperative paths (refresh / pre-paint hydrate / meta confirm)
 * keep the store the only writer.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { agentService } from '@/services/agent';

import { useAgentStore } from '../../store';
import { initialBuiltinAgentSliceState } from './initialState';
import { builtinAgentResource } from './projection';

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    getBuiltinAgent: vi.fn(),
  },
}));

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

const builtin = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, ...extra }) as any;

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {}) as Promise<any>;

/** Row key of the builtin replica entry (`key` is the slug, no query). */
const PERSIST_KEY = builtinAgentResource.storageKey({ slug: 'inbox' });

describe('builtin agent replica', () => {
  const scopes = new Set<string>();
  let scope = '';
  const useScope = (next: string) => {
    scope = next;
    scopes.add(next);
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  };

  beforeEach(() => {
    useScope(`builtin-user-${randomUUID()}:personal`);
    act(() => useAgentStore.setState(initialBuiltinAgentSliceState));
    vi.mocked(agentService.getBuiltinAgent).mockReset();
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].map((value) =>
        builtinAgentResource.storage!.remove({ queryKey: PERSIST_KEY, scope: value }),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted slug → id and config before the network answers', async () => {
    await builtinAgentResource.storage!.set(
      { queryKey: PERSIST_KEY, scope },
      {
        data: builtin('cached-inbox', {
          name: 'Custom chief',
          profile: { fullBodyArtwork: '/custom-chief.webp' },
        }),
        updatedAt: 1,
      },
    );
    vi.mocked(agentService.getBuiltinAgent).mockImplementation(pending);

    const sync = renderHook(
      () => useAgentStore.getState().useInitBuiltinAgent('inbox', { isLogin: true }),
      { wrapper },
    );

    await waitFor(() =>
      expect(useAgentStore.getState().builtinAgentIdMap.inbox).toBe('cached-inbox'),
    );
    expect(useAgentStore.getState().builtinAgentMap.inbox).toMatchObject({
      name: 'Custom chief',
    });
    // The persisted config re-seeds the surface that paints the builtin identity.
    expect(useAgentStore.getState().agentMap['cached-inbox']).toMatchObject({
      name: 'Custom chief',
      profile: { fullBodyArtwork: '/custom-chief.webp' },
    });
    expect(useAgentStore.getState().builtinAgentReplica.entries['inbox'].source).toBe('storage');
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
    // Data is on screen, so nothing is loading from the caller's point of view.
    expect(sync.result.current.isLoading).toBe(false);
    expect(typeof sync.result.current.mutate).toBe('function');
  });

  it('replaces with the server answer and persists it', async () => {
    vi.mocked(agentService.getBuiltinAgent).mockResolvedValue(
      builtin('inbox-1', { name: 'Server chief' }),
    );

    const sync = renderHook(
      () => useAgentStore.getState().useInitBuiltinAgent('inbox', { isLogin: true }),
      { wrapper },
    );

    await waitFor(() => expect(useAgentStore.getState().builtinAgentIdMap.inbox).toBe('inbox-1'));
    expect(useAgentStore.getState().agentMap['inbox-1']).toMatchObject({ name: 'Server chief' });
    expect(agentService.getBuiltinAgent).toHaveBeenCalledWith('inbox');

    await waitFor(async () =>
      expect(
        (await builtinAgentResource.storage!.get({ queryKey: PERSIST_KEY, scope }))?.data,
      ).toMatchObject({ id: 'inbox-1' }),
    );
    expect(sync.result.current.isLoading).toBe(false);
  });

  it('drops the previous identity’s builtin before the next one paints', async () => {
    vi.mocked(agentService.getBuiltinAgent).mockResolvedValue(builtin('inbox-a'));
    const sync = renderHook(
      () => useAgentStore.getState().useInitBuiltinAgent('inbox', { isLogin: true }),
      { wrapper },
    );
    await waitFor(() => expect(useAgentStore.getState().builtinAgentIdMap.inbox).toBe('inbox-a'));

    // The switched-to identity has nothing persisted and its fetch hangs.
    vi.mocked(agentService.getBuiltinAgent).mockImplementation(pending);
    useScope(`builtin-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(useAgentStore.getState().builtinAgentIdMap.inbox).toBeUndefined());
    expect(useAgentStore.getState().builtinAgentMap.inbox).toBeUndefined();
    expect(useAgentStore.getState().builtinAgentReplica.scope).toBe(scope);
  });

  it('pre-hydrates the persisted builtin for a route loader before the network answers', async () => {
    await builtinAgentResource.storage!.set(
      { queryKey: PERSIST_KEY, scope },
      { data: builtin('cached-inbox', { name: 'Custom chief' }), updatedAt: 1 },
    );
    vi.mocked(agentService.getBuiltinAgent).mockImplementation(pending);

    let hydrated = false;
    await act(async () => {
      hydrated = await useAgentStore.getState().preHydrateBuiltinAgent('inbox');
    });

    expect(hydrated).toBe(true);
    expect(useAgentStore.getState().builtinAgentIdMap.inbox).toBe('cached-inbox');
    expect(useAgentStore.getState().builtinAgentMap.inbox).toMatchObject({
      name: 'Custom chief',
    });
    expect(useAgentStore.getState().agentMap['cached-inbox']).toBeDefined();
    // The loader path never hits the network: it only reads the local copy.
    expect(agentService.getBuiltinAgent).not.toHaveBeenCalled();
  });

  it('does not paint or persist a refresh response after an identity switch', async () => {
    let resolveFetch!: (value: any) => void;
    vi.mocked(agentService.getBuiltinAgent).mockImplementation(
      () => new Promise((resolve) => (resolveFetch = resolve)),
    );

    const operation = useAgentStore.getState().refreshBuiltinAgent('inbox');

    // The user switches identity while the refresh is in flight.
    const switched = `builtin-user-${randomUUID()}:personal`;
    useScope(switched);

    await act(async () => {
      resolveFetch(builtin('inbox-a'));
      await operation;
    });

    expect(useAgentStore.getState().builtinAgentIdMap.inbox).toBeUndefined();
    expect(useAgentStore.getState().agentMap['inbox-a']).toBeUndefined();
    expect(
      (await builtinAgentResource.storage!.get({ queryKey: PERSIST_KEY, scope: switched }))?.data,
    ).toBeUndefined();
  });

  it('confirms a meta-edit response on the builtin without a network round-trip', () => {
    act(() => {
      useAgentStore.setState({
        builtinAgentIdMap: { inbox: 'inbox-1' },
        builtinAgentMap: { inbox: builtin('inbox-1', { name: 'Old chief' }) },
      });
    });

    act(() => {
      useAgentStore.getState().internal_replaceBuiltinAgent(
        'inbox',
        builtin('inbox-1', {
          name: 'Renamed chief',
          profile: { fullBodyArtwork: '/new-chief.webp' },
        }),
      );
    });

    expect(agentService.getBuiltinAgent).not.toHaveBeenCalled();
    expect(useAgentStore.getState().builtinAgentIdMap.inbox).toBe('inbox-1');
    expect(useAgentStore.getState().builtinAgentMap.inbox).toMatchObject({ name: 'Renamed chief' });
    expect(useAgentStore.getState().agentMap['inbox-1']).toMatchObject({ name: 'Renamed chief' });
  });

  it('does not fetch while the caller is logged out', async () => {
    renderHook(() => useAgentStore.getState().useInitBuiltinAgent('inbox', { isLogin: false }), {
      wrapper,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(agentService.getBuiltinAgent).not.toHaveBeenCalled();
    expect(useAgentStore.getState().builtinAgentIdMap.inbox).toBeUndefined();
  });
});

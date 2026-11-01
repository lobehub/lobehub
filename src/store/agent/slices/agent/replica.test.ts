/**
 * @vitest-environment happy-dom
 *
 * The agent store's remaining reads are replicas: a custom `/agent/<slug>`
 * lookup, the available-agents list the chat context delegates to, and the
 * server-default heterogeneous capability. Each paints its persisted copy
 * before the network answers, is partitioned by scope, and keeps the last
 * confirmed value when a background refresh fails.
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
import { aiAgentService } from '@/services/aiAgent';

import { useAgentStore } from '../../store';
import { initialAgentSliceState } from './initialState';
import {
  agentSlugIdResource,
  availableAgentsResource,
  heteroServerDefaultCapabilityResource,
} from './projection';

vi.mock('@/services/agent', () => ({
  AVAILABLE_AGENTS_CONTEXT_QUERY_LIMIT: 12,
  agentService: {
    queryAgents: vi.fn(),
    resolveAgentIdBySlug: vi.fn(),
  },
}));

vi.mock('@/services/aiAgent', () => ({
  aiAgentService: { getServerDefaultHeterogeneousCapability: vi.fn() },
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

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {}) as Promise<any>;

const agentItem = (id: string, title = id) => ({
  avatar: null,
  backgroundColor: null,
  description: null,
  id,
  name: null,
  title,
});

const SLUG_KEY = (slug: string) => agentSlugIdResource.storageKey({ slug });
const AVAILABLE_KEY = availableAgentsResource.storageKey({});
const CAPABILITY_KEY = heteroServerDefaultCapabilityResource.storageKey({});

const enabledCapability = {
  agents: ['claude-code'],
  enabled: true,
  model: 'lobehub-default',
  models: { 'claude-code': ['claude-sonnet'] },
} as any;

describe('agent store replicas', () => {
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
    useScope(`agent-store-user-${randomUUID()}:personal`);
    act(() => useAgentStore.setState(initialAgentSliceState));
    vi.mocked(agentService.queryAgents).mockReset();
    vi.mocked(agentService.resolveAgentIdBySlug).mockReset();
    vi.mocked(aiAgentService.getServerDefaultHeterogeneousCapability).mockReset();
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) => [
        agentSlugIdResource.storage!.remove({ queryKey: SLUG_KEY('my-writer'), scope: value }),
        agentSlugIdResource.storage!.remove({ queryKey: SLUG_KEY('new-writer'), scope: value }),
        availableAgentsResource.storage!.remove({ queryKey: AVAILABLE_KEY, scope: value }),
        heteroServerDefaultCapabilityResource.storage!.remove({
          queryKey: CAPABILITY_KEY,
          scope: value,
        }),
      ]),
    );
    scopes.clear();
    vi.restoreAllMocks();
  });

  describe('agent slug', () => {
    it('paints the persisted slug → id, then confirms it from the server', async () => {
      await agentSlugIdResource.storage!.set(
        { queryKey: SLUG_KEY('my-writer'), scope },
        { data: 'agt_writer', updatedAt: 1 },
      );
      let resolveLookup!: (value: string | null) => void;
      vi.mocked(agentService.resolveAgentIdBySlug).mockImplementation(
        () => new Promise((resolve) => (resolveLookup = resolve)),
      );

      renderHook(() => useAgentStore.getState().useResolveAgentSlug('my-writer'), { wrapper });

      await waitFor(() =>
        expect(useAgentStore.getState().agentSlugIdMap['my-writer']).toBe('agt_writer'),
      );
      // Painted from storage only: the redirect must still wait for the server.
      expect(useAgentStore.getState().agentSlugIdReplica.entries['my-writer'].source).toBe(
        'storage',
      );

      await act(async () => resolveLookup('agt_writer'));
      await waitFor(() =>
        expect(useAgentStore.getState().agentSlugIdReplica.entries['my-writer'].source).toBe(
          'server',
        ),
      );
      expect(agentService.resolveAgentIdBySlug).toHaveBeenCalledWith('my-writer');
    });

    it('follows a slug that moved to another agent between sessions', async () => {
      await agentSlugIdResource.storage!.set(
        { queryKey: SLUG_KEY('my-writer'), scope },
        { data: 'agt_old', updatedAt: 1 },
      );
      vi.mocked(agentService.resolveAgentIdBySlug).mockResolvedValue('agt_new');

      renderHook(() => useAgentStore.getState().useResolveAgentSlug('my-writer'), { wrapper });

      await waitFor(() =>
        expect(useAgentStore.getState().agentSlugIdMap['my-writer']).toBe('agt_new'),
      );
      await waitFor(async () =>
        expect(
          (await agentSlugIdResource.storage!.get({ queryKey: SLUG_KEY('my-writer'), scope }))
            ?.data,
        ).toBe('agt_new'),
      );
    });

    it('drops a slug no agent owns anymore from memory and storage', async () => {
      await agentSlugIdResource.storage!.set(
        { queryKey: SLUG_KEY('my-writer'), scope },
        { data: 'agt_writer', updatedAt: 1 },
      );
      vi.mocked(agentService.resolveAgentIdBySlug).mockResolvedValue(null);

      renderHook(() => useAgentStore.getState().useResolveAgentSlug('my-writer'), { wrapper });

      await waitFor(() => expect(agentService.resolveAgentIdBySlug).toHaveBeenCalled());
      await waitFor(() =>
        expect(useAgentStore.getState().agentSlugIdMap['my-writer']).toBeUndefined(),
      );
      await waitFor(async () =>
        expect(
          await agentSlugIdResource.storage!.get({ queryKey: SLUG_KEY('my-writer'), scope }),
        ).toBeUndefined(),
      );
    });

    it('keeps the confirmed id when a background lookup fails', async () => {
      vi.mocked(agentService.resolveAgentIdBySlug).mockResolvedValueOnce('agt_writer');
      const sync = renderHook(() => useAgentStore.getState().useResolveAgentSlug('my-writer'), {
        wrapper,
      });
      await waitFor(() =>
        expect(useAgentStore.getState().agentSlugIdMap['my-writer']).toBe('agt_writer'),
      );

      vi.mocked(agentService.resolveAgentIdBySlug).mockRejectedValue(new Error('offline'));
      await act(async () => {
        await sync.result.current.revalidate();
      });

      expect(useAgentStore.getState().agentSlugIdMap['my-writer']).toBe('agt_writer');
    });

    it('never shows the previous identity’s slug after a scope switch', async () => {
      await agentSlugIdResource.storage!.set(
        { queryKey: SLUG_KEY('my-writer'), scope },
        { data: 'agt_a', updatedAt: 1 },
      );
      vi.mocked(agentService.resolveAgentIdBySlug).mockImplementation(pending);
      const sync = renderHook(() => useAgentStore.getState().useResolveAgentSlug('my-writer'), {
        wrapper,
      });
      await waitFor(() =>
        expect(useAgentStore.getState().agentSlugIdMap['my-writer']).toBe('agt_a'),
      );

      useScope(`agent-store-user-${randomUUID()}:personal`);
      sync.rerender();

      await waitFor(() =>
        expect(useAgentStore.getState().agentSlugIdMap['my-writer']).toBeUndefined(),
      );
    });

    it('pre-hydrates the persisted slug for a route loader without the network', async () => {
      await agentSlugIdResource.storage!.set(
        { queryKey: SLUG_KEY('my-writer'), scope },
        { data: 'agt_writer', updatedAt: 1 },
      );

      let agentId: string | undefined;
      await act(async () => {
        agentId = await useAgentStore.getState().preHydrateAgentSlug('my-writer');
      });

      expect(agentId).toBe('agt_writer');
      expect(agentService.resolveAgentIdBySlug).not.toHaveBeenCalled();
    });

    it('moves the local copy with a slug rename, so the old slug stops naming the agent', async () => {
      await agentSlugIdResource.storage!.set(
        { queryKey: SLUG_KEY('my-writer'), scope },
        { data: 'agt_writer', updatedAt: 1 },
      );
      await act(async () => {
        await useAgentStore.getState().preHydrateAgentSlug('my-writer');
      });

      act(() => useAgentStore.getState().internal_confirmAgentSlug('agt_writer', 'new-writer'));

      expect(useAgentStore.getState().agentSlugIdMap).toEqual({ 'new-writer': 'agt_writer' });
      await waitFor(async () =>
        expect(
          await agentSlugIdResource.storage!.get({ queryKey: SLUG_KEY('my-writer'), scope }),
        ).toBeUndefined(),
      );
      await waitFor(async () =>
        expect(
          (await agentSlugIdResource.storage!.get({ queryKey: SLUG_KEY('new-writer'), scope }))
            ?.data,
        ).toBe('agt_writer'),
      );
    });

    // Codex P2: after a reload the old slug may sit only in storage.
    it('drops the previous slug’s persisted row on a rename even when it is not loaded', async () => {
      await agentSlugIdResource.storage!.set(
        { queryKey: SLUG_KEY('my-writer'), scope },
        { data: 'agt_writer', updatedAt: 1 },
      );

      act(() =>
        useAgentStore
          .getState()
          .internal_confirmAgentSlug('agt_writer', 'new-writer', { previousSlug: 'my-writer' }),
      );

      await waitFor(async () =>
        expect(
          await agentSlugIdResource.storage!.get({ queryKey: SLUG_KEY('my-writer'), scope }),
        ).toBeUndefined(),
      );
      let hydrated: string | undefined;
      await act(async () => {
        hydrated = await useAgentStore.getState().preHydrateAgentSlug('my-writer');
      });
      expect(hydrated).toBeUndefined();
    });

    // Codex P2: a rename answered after a workspace switch belongs to the old scope.
    it('never writes a rename confirmed after a scope switch into the new scope', async () => {
      const renamedIn = scope;
      useScope(`agent-store-user-${randomUUID()}:personal`);

      act(() =>
        useAgentStore
          .getState()
          .internal_confirmAgentSlug('agt_writer', 'new-writer', { scope: renamedIn }),
      );

      expect(useAgentStore.getState().agentSlugIdMap['new-writer']).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        await agentSlugIdResource.storage!.get({ queryKey: SLUG_KEY('new-writer'), scope }),
      ).toBeUndefined();
    });
  });

  describe('available agents', () => {
    it('paints the persisted list before the network answers, then replaces it', async () => {
      await availableAgentsResource.storage!.set(
        { queryKey: AVAILABLE_KEY, scope },
        { data: [agentItem('agt_cached')], updatedAt: 1 },
      );
      let resolveList!: (value: any) => void;
      vi.mocked(agentService.queryAgents).mockImplementation(
        () => new Promise((resolve) => (resolveList = resolve)),
      );

      renderHook(() => useAgentStore.getState().useFetchAvailableAgents(true), { wrapper });

      await waitFor(() =>
        expect(useAgentStore.getState().availableAgents).toEqual([agentItem('agt_cached')]),
      );

      await act(async () => resolveList([agentItem('agt_fresh')]));
      await waitFor(() =>
        expect(useAgentStore.getState().availableAgents).toEqual([agentItem('agt_fresh')]),
      );
      expect(agentService.queryAgents).toHaveBeenCalledWith({ limit: 12 });
    });

    it('sends one request for every conversation that mounts the sync', async () => {
      vi.mocked(agentService.queryAgents).mockResolvedValue([agentItem('agt_1')]);

      // One app-wide SWR cache whose default window is 0 (`useClientDataSWR`):
      // the shared window has to come from the sync itself.
      const cache = new Map();
      const sharedWrapper = ({ children }: PropsWithChildren) =>
        createElement(
          SWRConfig,
          { value: { dedupingInterval: 0, provider: () => cache } },
          createElement(MutateBridge),
          children,
        );

      renderHook(
        () => {
          useAgentStore.getState().useFetchAvailableAgents(true);
          useAgentStore.getState().useFetchAvailableAgents(true);
        },
        { wrapper: sharedWrapper },
      );
      await waitFor(() =>
        expect(useAgentStore.getState().availableAgents).toEqual([agentItem('agt_1')]),
      );
      // A conversation opened right after reuses the answer instead of asking again.
      renderHook(() => useAgentStore.getState().useFetchAvailableAgents(true), {
        wrapper: sharedWrapper,
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(agentService.queryAgents).toHaveBeenCalledTimes(1);
    });

    it('lets the chat context reuse the confirmed list until the agents change', async () => {
      act(() => useAgentStore.setState({ availableAgents: [agentItem('agt_1')] }));

      await expect(useAgentStore.getState().getAvailableAgents()).resolves.toEqual([
        agentItem('agt_1'),
      ]);
      expect(agentService.queryAgents).not.toHaveBeenCalled();

      vi.mocked(agentService.queryAgents).mockResolvedValue([agentItem('agt_2')]);
      act(() => useAgentStore.getState().invalidateAvailableAgents());
      let fresh: unknown;
      await act(async () => {
        fresh = await useAgentStore.getState().getAvailableAgents();
      });

      expect(fresh).toEqual([agentItem('agt_2')]);
      expect(agentService.queryAgents).toHaveBeenCalledTimes(1);
      expect(useAgentStore.getState().availableAgentsStale).toBe(false);
    });

    it('keeps the last list for the chat context when the refresh after a change fails', async () => {
      act(() => useAgentStore.setState({ availableAgents: [agentItem('agt_1')] }));
      act(() => useAgentStore.getState().invalidateAvailableAgents());
      vi.mocked(agentService.queryAgents).mockRejectedValueOnce(new Error('offline'));

      let listed: unknown;
      await act(async () => {
        listed = await useAgentStore.getState().getAvailableAgents();
      });

      expect(listed).toEqual([agentItem('agt_1')]);
      // Still untrusted: the next send tries a fresh list again.
      expect(useAgentStore.getState().availableAgentsStale).toBe(true);
    });

    // Codex P2: a second send while the fresh read is in flight must not get the stale list.
    it('shares one fresh read between concurrent sends and stays stale until it lands', async () => {
      act(() => useAgentStore.setState({ availableAgents: [agentItem('agt_old')] }));
      act(() => useAgentStore.getState().invalidateAvailableAgents());
      let resolveList!: (value: any) => void;
      vi.mocked(agentService.queryAgents).mockImplementation(
        () => new Promise((resolve) => (resolveList = resolve)),
      );

      const first = useAgentStore.getState().getAvailableAgents();
      const second = useAgentStore.getState().getAvailableAgents();
      expect(useAgentStore.getState().availableAgentsStale).toBe(true);

      await act(async () => resolveList([agentItem('agt_new')]));

      await expect(first).resolves.toEqual([agentItem('agt_new')]);
      await expect(second).resolves.toEqual([agentItem('agt_new')]);
      expect(agentService.queryAgents).toHaveBeenCalledTimes(1);
      expect(useAgentStore.getState().availableAgentsStale).toBe(false);
    });

    it('does not let a read from before a change confirm the list', async () => {
      act(() => useAgentStore.setState({ availableAgents: [agentItem('agt_old')] }));
      act(() => useAgentStore.getState().invalidateAvailableAgents());
      const answers: ((value: any) => void)[] = [];
      vi.mocked(agentService.queryAgents).mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );

      const before = useAgentStore.getState().getAvailableAgents();
      // Another agent is created while that read is in flight.
      act(() => useAgentStore.getState().invalidateAvailableAgents());
      const after = useAgentStore.getState().getAvailableAgents();

      await act(async () => answers[0]([agentItem('agt_mid')]));
      await before;
      expect(useAgentStore.getState().availableAgentsStale).toBe(true);

      await act(async () => answers[1]([agentItem('agt_new')]));
      await expect(after).resolves.toEqual([agentItem('agt_new')]);
      expect(useAgentStore.getState().availableAgentsStale).toBe(false);
    });

    // Codex P1: a refresh started under identity A must never answer a send of identity B.
    it('never hands a refresh started in another identity to this one', async () => {
      act(() => useAgentStore.getState().invalidateAvailableAgents());
      const answers: ((value: any) => void)[] = [];
      vi.mocked(agentService.queryAgents).mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );

      const inA = useAgentStore.getState().getAvailableAgents();
      useScope(`agent-store-user-${randomUUID()}:personal`);
      const inB = useAgentStore.getState().getAvailableAgents();

      expect(agentService.queryAgents).toHaveBeenCalledTimes(2);
      await act(async () => answers[0]([agentItem('agt_private_to_a')]));
      await act(async () => answers[1]([agentItem('agt_of_b')]));

      await expect(inB).resolves.toEqual([agentItem('agt_of_b')]);
      await inA.catch(() => undefined);
    });

    // Codex P2: a fresh read in identity B must not vouch for identity A's persisted list.
    it('keeps a change in one identity stale until that identity confirms it', async () => {
      const scopeA = scope;
      act(() => useAgentStore.setState({ availableAgents: [agentItem('agt_deleted')] }));
      act(() => useAgentStore.getState().invalidateAvailableAgents());

      useScope(`agent-store-user-${randomUUID()}:personal`);
      vi.mocked(agentService.queryAgents).mockResolvedValueOnce([agentItem('agt_of_b')]);
      act(() => useAgentStore.setState({ availableAgents: undefined }));
      await act(async () => {
        await useAgentStore.getState().getAvailableAgents();
      });

      // Back in A, its pre-change persisted copy is restored.
      useScope(scopeA);
      act(() => useAgentStore.setState({ availableAgents: [agentItem('agt_deleted')] }));
      vi.mocked(agentService.queryAgents).mockResolvedValueOnce([agentItem('agt_kept')]);
      let listed: unknown;
      await act(async () => {
        listed = await useAgentStore.getState().getAvailableAgents();
      });

      expect(listed).toEqual([agentItem('agt_kept')]);
      expect(agentService.queryAgents).toHaveBeenCalledTimes(2);
    });

    it('keeps the last list when a background refresh fails', async () => {
      vi.mocked(agentService.queryAgents).mockResolvedValueOnce([agentItem('agt_1')]);
      const sync = renderHook(() => useAgentStore.getState().useFetchAvailableAgents(true), {
        wrapper,
      });
      await waitFor(() =>
        expect(useAgentStore.getState().availableAgents).toEqual([agentItem('agt_1')]),
      );

      vi.mocked(agentService.queryAgents).mockRejectedValue(new Error('offline'));
      await act(async () => {
        await sync.result.current.revalidate();
      });

      expect(useAgentStore.getState().availableAgents).toEqual([agentItem('agt_1')]);
    });
  });

  describe('server-default heterogeneous capability', () => {
    it('paints the persisted capability before the network answers', async () => {
      await heteroServerDefaultCapabilityResource.storage!.set(
        { queryKey: CAPABILITY_KEY, scope },
        { data: enabledCapability, updatedAt: 1 },
      );
      vi.mocked(aiAgentService.getServerDefaultHeterogeneousCapability).mockImplementation(pending);

      renderHook(
        () => useAgentStore.getState().useFetchServerDefaultHeterogeneousCapability(true),
        { wrapper },
      );

      await waitFor(() =>
        expect(useAgentStore.getState().heteroServerDefaultCapability).toEqual(enabledCapability),
      );
    });

    it('keeps the last capability when a background refresh fails', async () => {
      vi.mocked(aiAgentService.getServerDefaultHeterogeneousCapability).mockResolvedValueOnce(
        enabledCapability,
      );
      const sync = renderHook(
        () => useAgentStore.getState().useFetchServerDefaultHeterogeneousCapability(true),
        { wrapper },
      );
      await waitFor(() =>
        expect(useAgentStore.getState().heteroServerDefaultCapability).toEqual(enabledCapability),
      );

      vi.mocked(aiAgentService.getServerDefaultHeterogeneousCapability).mockRejectedValue(
        new Error('offline'),
      );
      await act(async () => {
        await sync.result.current.revalidate();
      });

      expect(useAgentStore.getState().heteroServerDefaultCapability).toEqual(enabledCapability);
    });

    it('does not fetch while no surface needs it', () => {
      renderHook(
        () => useAgentStore.getState().useFetchServerDefaultHeterogeneousCapability(false),
        { wrapper },
      );

      expect(aiAgentService.getServerDefaultHeterogeneousCapability).not.toHaveBeenCalled();
    });
  });
});

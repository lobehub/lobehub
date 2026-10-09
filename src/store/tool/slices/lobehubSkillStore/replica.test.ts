/**
 * @vitest-environment happy-dom
 *
 * The connected LobeHub Skill providers are a replica: the settings / skill
 * store / chat-input surfaces paint the persisted list on the first frame, the
 * network only confirms, and a connect / revoke shows on the row at once. One
 * provider's tool catalog is a replica too.
 */
import { randomUUID } from 'node:crypto';

import type * as LobechatConstModule from '@lobechat/const';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { useUserStore } from '@/store/user';

import { useToolStore } from '../../store';
import { initialLobehubSkillStoreState } from './initialState';
import { lobehubSkillProviderToolsResource, lobehubSkillServersResource } from './projection';
import { lobehubSkillStoreSelectors } from './selectors';
import { LobehubSkillStatus } from './types';

const mocks = vi.hoisted(() => ({
  connectGetStatus: vi.fn(),
  connectListConnections: vi.fn(),
  connectListTools: vi.fn(),
  connectRevoke: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  toolsClient: {
    market: {
      connectGetStatus: { query: mocks.connectGetStatus },
      connectListConnections: { query: mocks.connectListConnections },
      connectListTools: { query: mocks.connectListTools },
      connectRevoke: { mutate: mocks.connectRevoke },
    },
  },
}));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();
  return {
    ...actual,
    getLobehubSkillProviderById: vi.fn((id: string) => ({
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      icon: '🔗',
    })),
  };
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

/** A connection row, as the Market `connectListConnections` returns it. */
const connection = (providerId: string) => ({
  icon: `${providerId}-icon`,
  providerId,
  providerUsername: 'testuser',
  scopes: ['read'],
  tokenExpiresAt: '2024-12-31T00:00:00Z',
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const SERVERS_STORAGE_KEY = lobehubSkillServersResource.storageKey({} as Record<string, never>);
const PROVIDER_TOOLS_STORAGE_KEY = lobehubSkillProviderToolsResource.storageKey('linear');

const serverIds = () =>
  (useToolStore.getState().lobehubSkillServers ?? []).map((s) => s.identifier);

describe('lobehubSkill connections replica', () => {
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
    useScope(`lobehub-skill-user-${randomUUID()}:personal`);
    act(() => useToolStore.setState(initialLobehubSkillStoreState));
    act(() => useUserStore.setState({ isSignedIn: true }));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all([
      ...[...scopes].map((value) =>
        lobehubSkillServersResource.storage!.remove({
          queryKey: SERVERS_STORAGE_KEY,
          scope: value,
        }),
      ),
      ...[...scopes].map((value) =>
        lobehubSkillProviderToolsResource.storage!.remove({
          queryKey: PROVIDER_TOOLS_STORAGE_KEY,
          scope: value,
        }),
      ),
    ]);
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    const cached = {
      identifier: 'linear',
      isConnected: true,
      name: 'Linear',
      status: LobehubSkillStatus.CONNECTED,
    };
    await lobehubSkillServersResource.storage!.set(
      { queryKey: SERVERS_STORAGE_KEY, scope },
      { data: [cached], updatedAt: 1 },
    );
    mocks.connectListConnections.mockImplementation(pending);
    mocks.connectListTools.mockResolvedValue({ tools: [] });

    const sync = renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), {
      wrapper,
    });

    await waitFor(() => expect(serverIds()).toEqual(['linear']));
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the list with the server response and persists it', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('linear')] });
    mocks.connectListTools.mockResolvedValue({ tools: [] });

    renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), { wrapper });

    await waitFor(() => expect(serverIds()).toEqual(['linear']));
    const [server] = useToolStore.getState().lobehubSkillServers!;
    expect(server.name).toBe('Linear');
    expect(server.status).toBe(LobehubSkillStatus.CONNECTED);
    expect(server.providerUsername).toBe('testuser');

    await waitFor(async () =>
      expect(
        (
          await lobehubSkillServersResource.storage!.get({
            queryKey: SERVERS_STORAGE_KEY,
            scope,
          })
        )?.data.map((s) => s.identifier),
      ).toEqual(['linear']),
    );
  });

  it('drops the previous identity’s servers before the next one paints', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('linear')] });
    mocks.connectListTools.mockResolvedValue({ tools: [] });

    const sync = renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(serverIds()).toHaveLength(1));

    mocks.connectListConnections.mockImplementation(pending);
    useScope(`lobehub-skill-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(useToolStore.getState().lobehubSkillServers).toBeUndefined());
  });

  it('does not fetch while the sync is disabled', async () => {
    renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(false), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mocks.connectListConnections).not.toHaveBeenCalled();
    expect(useToolStore.getState().lobehubSkillServers).toBeUndefined();
  });

  it('shows a newly connected provider at once', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [] });
    mocks.connectListTools.mockResolvedValue({ tools: [] });
    mocks.connectGetStatus.mockResolvedValue({
      connected: true,
      connection: { providerUsername: 'testuser' },
      icon: 'github-icon',
    });

    renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().lobehubSkillServers).toEqual([]));

    await act(async () => {
      await useToolStore.getState().checkLobehubSkillStatus('github');
    });

    expect(serverIds()).toEqual(['github']);
    expect(useToolStore.getState().lobehubSkillServers![0].status).toBe(
      LobehubSkillStatus.CONNECTED,
    );
  });

  it('keeps a just-connected provider when a list response that predates it lands', async () => {
    // The list loads empty first, then a response racing the connect arrives.
    mocks.connectListConnections.mockResolvedValue({ connections: [] });
    mocks.connectListTools.mockResolvedValue({ tools: [] });
    mocks.connectGetStatus.mockResolvedValue({ connected: true, icon: 'github-icon' });

    const sync = renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(useToolStore.getState().lobehubSkillServers).toEqual([]));

    await act(async () => {
      await useToolStore.getState().checkLobehubSkillStatus('github');
    });
    expect(serverIds()).toEqual(['github']);

    // The `connectListConnections` response the connect raced (no new row) lands.
    await act(async () => {
      await sync.result.current.mutate();
    });

    expect(serverIds()).toEqual(['github']);
  });

  it('hands the list back to the server once it echoes the new provider', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [] });
    mocks.connectListTools.mockResolvedValue({ tools: [] });
    mocks.connectGetStatus.mockResolvedValue({ connected: true, icon: 'github-icon' });

    const sync = renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(useToolStore.getState().lobehubSkillServers).toEqual([]));

    await act(async () => {
      await useToolStore.getState().checkLobehubSkillStatus('github');
    });

    // The server now lists it: the local intent settles and the response rules.
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('github')] });
    await act(async () => {
      await sync.result.current.mutate();
    });

    expect(serverIds()).toEqual(['github']);
    expect(useToolStore.getState().lobehubSkillServers![0].providerUsername).toBe('testuser');

    // A later response without the row drops it — the server is authoritative again.
    mocks.connectListConnections.mockResolvedValue({ connections: [] });
    await act(async () => {
      await sync.result.current.mutate();
    });

    expect(serverIds()).toEqual([]);
  });

  it('revokes a provider locally and keeps a stale list response from resurrecting it', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('linear')] });
    mocks.connectListTools.mockResolvedValue({ tools: [] });
    mocks.connectRevoke.mockResolvedValue({});

    const sync = renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(serverIds()).toEqual(['linear']));

    await act(async () => {
      await useToolStore.getState().revokeLobehubSkill('linear');
    });

    expect(serverIds()).toEqual([]);
    expect(mocks.connectRevoke).toHaveBeenCalledWith({ provider: 'linear' });

    // A list response that predates the revoke still lists the provider.
    await act(async () => {
      await sync.result.current.mutate();
    });

    expect(serverIds()).toEqual([]);
  });

  it('keeps a revoked provider hidden until a response confirms it is gone', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('linear')] });
    mocks.connectListTools.mockResolvedValue({ tools: [] });
    mocks.connectRevoke.mockResolvedValue({});

    const sync = renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(serverIds()).toEqual(['linear']));

    await act(async () => {
      await useToolStore.getState().revokeLobehubSkill('linear');
    });

    // The server confirms it is gone …
    mocks.connectListConnections.mockResolvedValue({ connections: [] });
    await act(async () => {
      await sync.result.current.mutate();
    });

    // … so a later, legitimate re-connect is shown again.
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('linear')] });
    await act(async () => {
      await sync.result.current.mutate();
    });

    expect(serverIds()).toEqual(['linear']);
  });

  it('shows a provider re-connected inside the revoke race window', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('linear')] });
    mocks.connectListTools.mockResolvedValue({ tools: [] });
    mocks.connectRevoke.mockResolvedValue({});
    mocks.connectGetStatus.mockResolvedValue({ connected: true, icon: 'linear-icon' });

    const sync = renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(serverIds()).toEqual(['linear']));

    await act(async () => {
      await useToolStore.getState().revokeLobehubSkill('linear');
    });
    expect(serverIds()).toEqual([]);

    // Re-connected before any response confirmed the revoke: the fresh write
    // supersedes the pending revoke, so the row shows again …
    await act(async () => {
      await useToolStore.getState().checkLobehubSkillStatus('linear');
    });
    expect(serverIds()).toEqual(['linear']);

    // … and a list response that still lists it keeps showing it.
    await act(async () => {
      await sync.result.current.mutate();
    });
    expect(serverIds()).toEqual(['linear']);
  });

  it('keeps the connect response tools on the provider row for the agent tool list', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('linear')] });
    mocks.connectListTools.mockResolvedValue({
      tools: [
        { description: 'Create an issue', inputSchema: { type: 'object' }, name: 'createIssue' },
      ],
    });

    renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), { wrapper });

    await waitFor(() =>
      expect(useToolStore.getState().lobehubSkillServers?.[0].tools).toHaveLength(1),
    );
    expect(useToolStore.getState().lobehubSkillServers?.[0].tools![0].name).toBe('createIssue');
  });

  it('keeps a connected provider’s cached tools when a revalidation drops them and the tool fetch fails', async () => {
    mocks.connectListConnections.mockResolvedValue({ connections: [connection('linear')] });
    mocks.connectListTools.mockResolvedValue({
      tools: [
        { description: 'Create an issue', inputSchema: { type: 'object' }, name: 'createIssue' },
      ],
    });

    const sync = renderHook(() => useToolStore((s) => s.useFetchLobehubSkillConnections)(true), {
      wrapper,
    });
    await waitFor(() =>
      expect(useToolStore.getState().lobehubSkillServers?.[0].tools).toHaveLength(1),
    );

    // The revalidation's list response carries no tools, and this time the
    // follow-up `connectListTools` call fails.
    mocks.connectListTools.mockRejectedValue(new Error('network down'));
    await act(async () => {
      await sync.result.current.mutate();
    });

    // The persisted catalog survives on the row, so the provider still resolves
    // for the agent tool list even though the refresh failed.
    expect(mocks.connectListTools).toHaveBeenCalledWith({ provider: 'linear' });
    expect(useToolStore.getState().lobehubSkillServers?.[0].tools).toHaveLength(1);
    expect(
      lobehubSkillStoreSelectors.lobehubSkillAsLobeTools(useToolStore.getState()),
    ).toHaveLength(1);
  });

  it('paints a provider’s persisted tool catalog before the network answers', async () => {
    const cachedTool = {
      description: 'Cached tool',
      inputSchema: { type: 'object' },
      name: 'cached',
    };
    await lobehubSkillProviderToolsResource.storage!.set(
      { queryKey: PROVIDER_TOOLS_STORAGE_KEY, scope },
      { data: [cachedTool], updatedAt: 1 },
    );
    mocks.connectListTools.mockImplementation(pending);

    const sync = renderHook(() => useToolStore((s) => s.useFetchProviderTools)('linear'), {
      wrapper,
    });

    await waitFor(() =>
      expect(useToolStore.getState().lobehubSkillToolsMap.linear).toEqual([cachedTool]),
    );
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces a provider’s tool catalog with the network response and persists it', async () => {
    mocks.connectListTools.mockResolvedValue({
      tools: [
        {
          description: 'Create an issue',
          inputSchema: { type: 'object' },
          name: 'createIssue',
          // Not rendered anywhere: the projection keeps only the three fields.
          weirdMarketField: 'ignored',
        },
      ],
    });

    renderHook(() => useToolStore((s) => s.useFetchProviderTools)('linear'), { wrapper });

    await waitFor(() =>
      expect(useToolStore.getState().lobehubSkillToolsMap.linear).toEqual([
        { description: 'Create an issue', inputSchema: { type: 'object' }, name: 'createIssue' },
      ]),
    );

    await waitFor(async () =>
      expect(
        (
          await lobehubSkillProviderToolsResource.storage!.get({
            queryKey: PROVIDER_TOOLS_STORAGE_KEY,
            scope,
          })
        )?.data,
      ).toEqual([
        { description: 'Create an issue', inputSchema: { type: 'object' }, name: 'createIssue' },
      ]),
    );
  });
});

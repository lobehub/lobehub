/**
 * @vitest-environment happy-dom
 *
 * The Composio connections list is a replica: it paints the persisted copy on
 * the first frame, the network only confirms, and a connect / delete / refresh
 * shows on the row at once. The per-app tool catalog is a replica too.
 */
import { randomUUID } from 'node:crypto';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';

import { useToolStore } from '../../store';
import { initialComposioStoreState } from './initialState';
import {
  COMPOSIO_SERVERS_KEY,
  composioAppToolsResource,
  composioServersResource,
  createComposioLocalIntent,
  mergeComposioServers,
} from './projection';

const mocks = vi.hoisted(() => ({
  createConnection: vi.fn(),
  deleteConnection: vi.fn(),
  executeAction: vi.fn(),
  getActions: vi.fn(),
  getComposioPlugins: vi.fn(),
  getConnection: vi.fn(),
  listActions: vi.fn(),
  updateComposioPlugin: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    composio: {
      createConnection: { mutate: mocks.createConnection },
      deleteConnection: { mutate: mocks.deleteConnection },
      getComposioPlugins: { query: mocks.getComposioPlugins },
      getConnection: { query: mocks.getConnection },
      updateComposioPlugin: { mutate: mocks.updateComposioPlugin },
    },
  },
  toolsClient: {
    composio: {
      executeAction: { mutate: mocks.executeAction },
      getActions: { query: mocks.getActions },
      listActions: { query: mocks.listActions },
    },
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

/** A `user_installed_plugins` row carrying a Composio connection, as the server returns it. */
const composioPlugin = (
  identifier: string,
  overrides: {
    api?: { description?: string; name: string; parameters?: unknown }[];
    appSlug?: string;
    redirectUrl?: string;
    status?: string;
  } = {},
) => ({
  customParams: {
    composio: {
      appSlug: overrides.appSlug ?? identifier.toUpperCase(),
      authConfigId: `ac_${identifier}`,
      connectedAccountId: `ca_${identifier}`,
      redirectUrl: overrides.redirectUrl,
      status: overrides.status ?? 'ACTIVE',
    },
  },
  identifier,
  manifest: {
    api: overrides.api ?? [
      {
        description: `${identifier} tool`,
        name: `${identifier}_TOOL`,
        parameters: { type: 'object' },
      },
    ],
  },
});

/** Never-resolving fetch: the first frame can only come from storage. */
const pending = () => new Promise<never>(() => {});

const SERVERS_STORAGE_KEY = composioServersResource.storageKey({} as Record<string, never>);
const APP_TOOLS_STORAGE_KEY = composioAppToolsResource.storageKey('gmail');

/** Identifiers of the connections the store currently shows. */
const connectionIds = () => useToolStore.getState().composioServers.map((s) => s.identifier);

describe('composio connections replica', () => {
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
    useScope(`composio-user-${randomUUID()}:personal`);
    act(() => useToolStore.setState(initialComposioStoreState));
  });

  afterEach(async () => {
    cleanup();
    await Promise.all([
      ...[...scopes].map((value) =>
        composioServersResource.storage!.remove({ queryKey: SERVERS_STORAGE_KEY, scope: value }),
      ),
      ...[...scopes].map((value) =>
        composioAppToolsResource.storage!.remove({ queryKey: APP_TOOLS_STORAGE_KEY, scope: value }),
      ),
    ]);
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    const cached = {
      appSlug: 'GMAIL',
      authConfigId: 'ac_gmail',
      connectedAccountId: 'ca_gmail',
      createdAt: 0,
      identifier: 'gmail',
      label: 'Gmail',
      status: 'active' as const,
    };
    await composioServersResource.storage!.set(
      { queryKey: SERVERS_STORAGE_KEY, scope },
      { data: [cached], updatedAt: 1 },
    );
    mocks.getComposioPlugins.mockImplementation(pending);

    const sync = renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), {
      wrapper,
    });

    await waitFor(() =>
      expect(useToolStore.getState().composioServers.map((s) => s.identifier)).toEqual(['gmail']),
    );
    expect(useToolStore.getState().isComposioServersInit).toBe(true);
    expect(sync.result.current.isHydrated).toBe(true);
    expect(sync.result.current.isValidating).toBe(true);
  });

  it('replaces the list with the server response and persists it', async () => {
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('gmail')]);

    renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), { wrapper });

    await waitFor(() =>
      expect(useToolStore.getState().composioServers.map((s) => s.identifier)).toEqual(['gmail']),
    );
    const [server] = useToolStore.getState().composioServers;
    expect(server.status).toBe('active');
    expect(server.connectedAccountId).toBe('ca_gmail');
    expect(server.tools).toHaveLength(1);

    await waitFor(async () =>
      expect(
        (
          await composioServersResource.storage!.get({ queryKey: SERVERS_STORAGE_KEY, scope })
        )?.data.map((s) => s.identifier),
      ).toEqual(['gmail']),
    );
  });

  it('drops the previous identity’s servers before the next one paints', async () => {
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('gmail')]);

    const sync = renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(useToolStore.getState().composioServers).toHaveLength(1));

    mocks.getComposioPlugins.mockImplementation(pending);
    useScope(`composio-user-${randomUUID()}:personal`);
    sync.rerender();

    await waitFor(() => expect(useToolStore.getState().isComposioServersInit).toBe(false));
    expect(useToolStore.getState().composioServers).toEqual([]);
  });

  it('does not fetch while the sync is disabled', async () => {
    renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(false), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.getComposioPlugins).not.toHaveBeenCalled();
    expect(useToolStore.getState().isComposioServersInit).toBe(false);
  });

  it('appends a newly created connection to the list', async () => {
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('gmail')]);
    renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().composioServers).toHaveLength(1));

    mocks.createConnection.mockResolvedValue({
      authConfigId: 'ac_slack',
      connectedAccountId: 'ca_slack',
      identifier: 'slack',
      redirectUrl: 'https://composio.dev/redirect',
    });

    await act(async () => {
      await useToolStore
        .getState()
        .createComposioConnection({ appSlug: 'SLACK', identifier: 'slack', label: 'Slack' });
    });

    const identifiers = useToolStore.getState().composioServers.map((s) => s.identifier);
    expect(identifiers).toEqual(['gmail', 'slack']);
    const slack = useToolStore.getState().composioServers.find((s) => s.identifier === 'slack');
    expect(slack?.status).toBe('pending_auth');
    expect(slack?.redirectUrl).toBe('https://composio.dev/redirect');
  });

  it('drops the row locally and best-effort deletes the connection', async () => {
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('gmail')]);
    renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().composioServers).toHaveLength(1));

    await act(async () => {
      await useToolStore.getState().removeComposioConnection('gmail');
    });

    expect(useToolStore.getState().composioServers).toEqual([]);
    expect(mocks.deleteConnection).toHaveBeenCalledWith({
      connectedAccountId: 'ca_gmail',
      identifier: 'gmail',
    });
  });

  it('surfaces the error when the status refresh fails', async () => {
    // The failed refresh logs the cause; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('gmail', { status: 'PENDING' })]);
    renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().composioServers).toHaveLength(1));

    mocks.getConnection.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await useToolStore.getState().refreshComposioConnectionStatus('gmail');
    });

    const [server] = useToolStore.getState().composioServers;
    expect(server.status).toBe('error');
    expect(server.errorMessage).toBe('network down');
    expect(useToolStore.getState().loadingComposioServerIds.has('gmail')).toBe(false);
  });

  it('marks the connection active with its tools after a successful refresh', async () => {
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('gmail', { status: 'PENDING' })]);
    renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), { wrapper });
    await waitFor(() => expect(useToolStore.getState().composioServers).toHaveLength(1));

    mocks.getConnection.mockResolvedValue({ gmailReadPermission: true, status: 'ACTIVE' });
    mocks.listActions.mockResolvedValue({
      tools: [
        { description: 'Send email', inputSchema: { type: 'object' }, name: 'GMAIL_SEND_EMAIL' },
      ],
    });
    mocks.updateComposioPlugin.mockResolvedValue({ success: true });

    await act(async () => {
      await useToolStore.getState().refreshComposioConnectionStatus('gmail');
    });

    const [server] = useToolStore.getState().composioServers;
    expect(server.status).toBe('active');
    expect(server.gmailReadPermission).toBe(true);
    expect(server.redirectUrl).toBeUndefined();
    expect(server.tools?.map((t) => t.name)).toEqual(['GMAIL_SEND_EMAIL']);
    expect(mocks.updateComposioPlugin).toHaveBeenCalled();
  });

  it('keeps a new connection when a list response that predates it lands', async () => {
    // The list loads empty first, then a response racing the connect arrives.
    mocks.getComposioPlugins.mockResolvedValue([]);
    const sync = renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(useToolStore.getState().isComposioServersInit).toBe(true));

    mocks.createConnection.mockResolvedValue({
      authConfigId: 'ac_slack',
      connectedAccountId: 'ca_slack',
      identifier: 'slack',
      redirectUrl: 'https://composio.dev/redirect',
    });
    await act(async () => {
      await useToolStore
        .getState()
        .createComposioConnection({ appSlug: 'SLACK', identifier: 'slack', label: 'Slack' });
    });
    expect(connectionIds()).toEqual(['slack']);

    // The `getComposioPlugins` response the connect raced (no new row) lands.
    await act(async () => {
      await sync.result.current.mutate();
    });
    expect(connectionIds()).toEqual(['slack']);
  });

  it('hands the list back to the server once it echoes the new connection', async () => {
    mocks.getComposioPlugins.mockResolvedValue([]);
    const sync = renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(useToolStore.getState().isComposioServersInit).toBe(true));

    mocks.createConnection.mockResolvedValue({
      authConfigId: 'ac_slack',
      connectedAccountId: 'ca_slack',
      identifier: 'slack',
      redirectUrl: undefined,
    });
    await act(async () => {
      await useToolStore
        .getState()
        .createComposioConnection({ appSlug: 'SLACK', identifier: 'slack', label: 'Slack' });
    });

    // The server now echoes it: the local intent is settled.
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('slack')]);
    await act(async () => {
      await sync.result.current.mutate();
    });
    expect(connectionIds()).toEqual(['slack']);

    // A later response without it is authoritative again (e.g. removed elsewhere).
    mocks.getComposioPlugins.mockResolvedValue([]);
    await act(async () => {
      await sync.result.current.mutate();
    });
    expect(connectionIds()).toEqual([]);
  });

  it('keeps a removed connection gone when a list response that still has it lands', async () => {
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('gmail')]);
    const sync = renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(connectionIds()).toEqual(['gmail']));

    mocks.deleteConnection.mockResolvedValue({ success: true });
    await act(async () => {
      await useToolStore.getState().removeComposioConnection('gmail');
    });
    expect(connectionIds()).toEqual([]);

    // A list response fetched before the delete still carries the row.
    await act(async () => {
      await sync.result.current.mutate();
    });
    expect(connectionIds()).toEqual([]);

    // Once the server confirms it is gone, the server is authoritative again.
    mocks.getComposioPlugins.mockResolvedValue([]);
    await act(async () => {
      await sync.result.current.mutate();
    });
    expect(connectionIds()).toEqual([]);
  });

  it('still refreshes a connection created while a list response was in flight', async () => {
    // Reproduces the reported dead-end: connect, let the racing list response
    // land, then complete the OAuth flow — the row must still be there.
    mocks.getComposioPlugins.mockResolvedValue([]);
    const sync = renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(useToolStore.getState().isComposioServersInit).toBe(true));

    mocks.createConnection.mockResolvedValue({
      authConfigId: 'ac_slack',
      connectedAccountId: 'ca_slack',
      identifier: 'slack',
      redirectUrl: 'https://composio.dev/redirect',
    });
    await act(async () => {
      await useToolStore
        .getState()
        .createComposioConnection({ appSlug: 'SLACK', identifier: 'slack', label: 'Slack' });
    });
    await act(async () => {
      await sync.result.current.mutate();
    });

    mocks.getConnection.mockResolvedValue({ gmailReadPermission: false, status: 'ACTIVE' });
    mocks.listActions.mockResolvedValue({
      tools: [
        { description: 'Post a message', inputSchema: { type: 'object' }, name: 'SLACK_POST' },
      ],
    });
    mocks.updateComposioPlugin.mockResolvedValue({ success: true });

    await act(async () => {
      await useToolStore.getState().refreshComposioConnectionStatus('slack');
    });

    const server = useToolStore.getState().composioServers.find((s) => s.identifier === 'slack');
    expect(server?.status).toBe('active');
    expect(server?.tools?.map((t) => t.name)).toEqual(['SLACK_POST']);
    expect(mocks.updateComposioPlugin).toHaveBeenCalled();
  });

  it('revalidates through the connections sync mutate without clearing the list', async () => {
    mocks.getComposioPlugins.mockResolvedValue([composioPlugin('gmail')]);
    const sync = renderHook(() => useToolStore((s) => s.useFetchUserComposioConnections)(true), {
      wrapper,
    });
    await waitFor(() => expect(useToolStore.getState().composioServers).toHaveLength(1));

    await act(async () => {
      await sync.result.current.mutate();
    });

    expect(useToolStore.getState().composioServers).toHaveLength(1);
  });
});

describe('composio app tools replica', () => {
  let scope = '';

  beforeEach(() => {
    scope = `composio-user-${randomUUID()}:personal`;
    vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
    act(() => useToolStore.setState(initialComposioStoreState));
  });

  afterEach(async () => {
    cleanup();
    await composioAppToolsResource.storage!.remove({
      queryKey: APP_TOOLS_STORAGE_KEY,
      scope,
    });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted catalog before the network answers', async () => {
    const cached = [{ description: 'Send email', inputSchema: { type: 'object' }, name: 'SEND' }];
    await composioAppToolsResource.storage!.set(
      { queryKey: APP_TOOLS_STORAGE_KEY, scope },
      { data: cached, updatedAt: 1 },
    );
    mocks.getActions.mockImplementation(pending);

    const hook = renderHook(
      () => ({
        data: useToolStore((s) => s.composioAppToolsMap.gmail),
        sync: useToolStore((s) => s.useFetchAppTools)('gmail'),
      }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.data).toEqual(cached));
    expect(hook.result.current.sync.isValidating).toBe(true);
  });

  it('replaces the catalog with the server response and persists it', async () => {
    mocks.getActions.mockResolvedValue({
      tools: [{ description: 'List files', inputSchema: { type: 'object' }, name: 'LIST' }],
    });

    const hook = renderHook(
      () => ({
        data: useToolStore((s) => s.composioAppToolsMap.gmail),
        sync: useToolStore((s) => s.useFetchAppTools)('gmail'),
      }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.data?.[0]?.name).toBe('LIST'));
    await waitFor(async () =>
      expect(
        (
          await composioAppToolsResource.storage!.get({
            queryKey: APP_TOOLS_STORAGE_KEY,
            scope,
          })
        )?.data[0]?.name,
      ).toBe('LIST'),
    );
  });

  it('reads nothing for an unknown app without fetching', async () => {
    renderHook(() => useToolStore((s) => s.useFetchAppTools)(undefined), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.getActions).not.toHaveBeenCalled();
    expect(useToolStore.getState().composioAppToolsMap['gmail']).toBeUndefined();
  });

  it('exposes the connections key as a single scope entry', () => {
    expect(COMPOSIO_SERVERS_KEY).toBe('all');
  });
});

describe('mergeComposioServers', () => {
  const server = (identifier: string) => ({ identifier }) as never;

  it('carries a pending add and hides a pending remove until the server reflects them', () => {
    const intent = createComposioLocalIntent();
    intent.added.set('slack', server('slack'));
    intent.removed.add('gmail');

    // A response that predates both writes: the new row is re-appended, the
    // deleted one stays hidden.
    expect(mergeComposioServers([server('gmail')], intent).map((s) => s.identifier)).toEqual([
      'slack',
    ]);

    // The server echoes the add and confirms the removal: intent settles.
    expect(mergeComposioServers([server('slack')], intent).map((s) => s.identifier)).toEqual([
      'slack',
    ]);
    expect(intent.added.size).toBe(0);
    expect(intent.removed.size).toBe(0);

    // The server is authoritative again: a later response wins.
    expect(mergeComposioServers([server('gmail')], intent).map((s) => s.identifier)).toEqual([
      'gmail',
    ]);
  });

  it('returns the incoming list unchanged when nothing is pending', () => {
    const incoming = [server('gmail')];
    expect(mergeComposioServers(incoming, createComposioLocalIntent())).toBe(incoming);
  });
});

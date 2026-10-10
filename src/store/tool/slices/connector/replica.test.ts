/**
 * @vitest-environment happy-dom
 *
 * The connector lists are `@lobechat/replica` resources: the persisted
 * projection paints while the network confirms it, a permission write shows on
 * the row immediately and rolls back when the server rejects it, and a
 * confirmed delete drops the same connector from every list that holds it in
 * one fan-out.
 */
import { randomUUID } from 'node:crypto';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { broadcastCacheScope, resetCacheScopeBroadcast } from '@/libs/replica/cacheScopeEvents';
import { lambdaClient } from '@/libs/trpc/client';

import { useToolStore } from '../../store';
import { initialConnectorState } from './initialState';
import {
  agentBoundConnectorsResource,
  agentConnectorsResource,
  connectorsResource,
} from './projection';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    connector: {
      delete: { mutate: vi.fn() },
      list: { query: vi.fn() },
      listAgentBound: { query: vi.fn() },
      listByAgent: { query: vi.fn() },
      updateToolPermission: { mutate: vi.fn() },
    },
  },
}));

const listQuery = lambdaClient.connector.list.query as unknown as ReturnType<typeof vi.fn>;
const listAgentBoundQuery = lambdaClient.connector.listAgentBound.query as unknown as ReturnType<
  typeof vi.fn
>;
const listByAgentQuery = lambdaClient.connector.listByAgent.query as unknown as ReturnType<
  typeof vi.fn
>;
const deleteMutation = lambdaClient.connector.delete.mutate as unknown as ReturnType<typeof vi.fn>;
const updateToolPermissionMutation = lambdaClient.connector.updateToolPermission
  .mutate as unknown as ReturnType<typeof vi.fn>;

/** A connector with a single tool in it, enough to assert permissions on. */
const connector = (id: string, permission = 'auto') => ({
  id,
  identifier: id,
  tools: [{ id: `${id}-tool`, permission }],
});

/** Never-resolving fetch: what the store holds can only have come from storage. */
const pending = () => new Promise<never>(() => {});

const LIST_STORAGE_KEY = connectorsResource.storageKey({});
const AGENT_BOUND_STORAGE_KEY = agentBoundConnectorsResource.storageKey({});
const AGENT_STORAGE_KEY = agentConnectorsResource.storageKey({ agentId: 'a1' });

const storageKeys = {
  agents: AGENT_STORAGE_KEY,
  bound: AGENT_BOUND_STORAGE_KEY,
  list: LIST_STORAGE_KEY,
};

describe('connector slice replica', () => {
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
    useScope(`connector-user-${randomUUID()}:personal`);
    resetCacheScopeBroadcast();
    useToolStore.setState({ ...initialConnectorState });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(
      [...scopes].flatMap((value) =>
        Object.values(storageKeys).map((queryKey) =>
          connectorsResource.storage!.remove({ queryKey, scope: value }),
        ),
      ),
    );
    scopes.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('paints the persisted list before the network answers', async () => {
    await connectorsResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [connector('cached')], updatedAt: 1 },
    );
    listQuery.mockImplementation(pending);

    void useToolStore.getState().fetchConnectors();

    await vi.waitFor(() =>
      expect(useToolStore.getState().connectors.map((c) => c.id)).toEqual(['cached']),
    );
    expect(useToolStore.getState().isConnectorsInit).toBe(true);
  });

  it('replaces the list with the server response and persists it', async () => {
    listQuery.mockResolvedValue([connector('server-1')]);

    await useToolStore.getState().fetchConnectors();

    expect(useToolStore.getState().connectors.map((c) => c.id)).toEqual(['server-1']);
    expect(useToolStore.getState().isConnectorsInit).toBe(true);
    await vi.waitFor(async () =>
      expect(
        (await connectorsResource.storage!.get({ queryKey: LIST_STORAGE_KEY, scope }))?.data,
      ).toEqual([connector('server-1')]),
    );
  });

  it('never hydrates another identity’s persisted list', async () => {
    await connectorsResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [connector('mine')], updatedAt: 1 },
    );
    useScope(`connector-user-${randomUUID()}:personal`);
    listQuery.mockImplementation(pending);

    void useToolStore.getState().fetchConnectors();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(useToolStore.getState().connectors).toEqual([]);
    expect(useToolStore.getState().isConnectorsInit).toBe(false);
  });

  // These resources have no `useSync` mount: nothing re-renders them on a scope
  // switch, so the engine would keep the previous identity's views — and their
  // init flags, which is what makes every gated consumer skip the fetch for the
  // new scope.
  it('drops every connector view when the cache scope changes', async () => {
    listQuery.mockResolvedValue([connector('c1')]);
    listAgentBoundQuery.mockResolvedValue([connector('c1')]);
    listByAgentQuery.mockResolvedValue([connector('c1')]);

    await useToolStore.getState().fetchConnectors();
    await useToolStore.getState().fetchAgentBoundConnectors();
    await useToolStore.getState().fetchAgentConnectors('a1');
    expect(useToolStore.getState().connectors).toHaveLength(1);
    expect(useToolStore.getState().agentBoundConnectors).toHaveLength(1);
    expect(useToolStore.getState().agentConnectors.a1).toHaveLength(1);

    const workspaceScope = `${scope.split(':')[0]}:ws-1`;
    useScope(workspaceScope);
    broadcastCacheScope(workspaceScope);

    expect(useToolStore.getState().connectors).toEqual([]);
    expect(useToolStore.getState().isConnectorsInit).toBe(false);
    expect(useToolStore.getState().agentBoundConnectors).toEqual([]);
    expect(useToolStore.getState().isAgentBoundInit).toBe(false);
    expect(useToolStore.getState().agentConnectors).toEqual({});
    expect(useToolStore.getState().agentConnectorsInit).toEqual({});
  });

  // The reset the broadcast performs is also folded into the engine's own
  // commit, so a fetch that runs under a new scope without a broadcast (nothing
  // mounted `useCacheScope`) still cannot replace into the old scope's view.
  it('replaces a stale scope’s rows instead of merging into them', async () => {
    listQuery.mockResolvedValue([connector('personal-row')]);
    await useToolStore.getState().fetchConnectors();
    expect(useToolStore.getState().connectors.map((c) => c.id)).toEqual(['personal-row']);

    const workspaceScope = `${scope.split(':')[0]}:ws-1`;
    useScope(workspaceScope);
    listQuery.mockResolvedValue([connector('workspace-row')]);

    await useToolStore.getState().fetchConnectors();

    expect(useToolStore.getState().connectors.map((c) => c.id)).toEqual(['workspace-row']);
    expect(useToolStore.getState().isConnectorsInit).toBe(true);
  });

  // The reported boot: a direct workspace URL hydrates the personal projection
  // before the URL→store sync resolves the slug. The personal response that is
  // still in flight gets dropped — but if the hydrated view (and the init flag
  // it set) survived the switch, the workspace would keep painting the personal
  // inventory and never load its own.
  it('re-arms the workspace fetch after a personal-scope hydration', async () => {
    await connectorsResource.storage!.set(
      { queryKey: LIST_STORAGE_KEY, scope },
      { data: [connector('personal-stale')], updatedAt: 1 },
    );
    listQuery.mockImplementation(pending);

    void useToolStore.getState().fetchConnectors();
    await vi.waitFor(() =>
      expect(useToolStore.getState().connectors.map((c) => c.id)).toEqual(['personal-stale']),
    );

    const workspaceScope = `${scope.split(':')[0]}:ws-1`;
    useScope(workspaceScope);
    broadcastCacheScope(workspaceScope);

    // The gate is back to "not loaded", so the consumers gated on it fetch
    // again, and nothing from the personal partition is left on screen.
    expect(useToolStore.getState().isConnectorsInit).toBe(false);
    expect(useToolStore.getState().connectors).toEqual([]);
  });

  it('never persists connector secrets, but keeps them in the in-memory row', async () => {
    const withSecrets = {
      ...connector('c1'),
      mcpStdioConfig: { args: ['-y'], command: 'npx', env: { API_KEY: 'sk-live-secret' } },
      metadata: { customHeaders: { Authorization: 'Bearer header-secret' }, description: 'kept' },
    };
    listQuery.mockResolvedValue([withSecrets]);

    await useToolStore.getState().fetchConnectors();

    // The edit form still pre-fills from the in-memory row.
    const inMemory = useToolStore.getState().connectors[0] as typeof withSecrets;
    expect(inMemory.mcpStdioConfig.env).toEqual({ API_KEY: 'sk-live-secret' });
    expect(inMemory.metadata.customHeaders).toEqual({ Authorization: 'Bearer header-secret' });

    const persisted = await vi.waitFor(async () => {
      const row = await connectorsResource.storage!.get({ queryKey: LIST_STORAGE_KEY, scope });
      expect(row?.data).toBeDefined();
      return row!.data as unknown as Array<typeof withSecrets>;
    });

    expect('env' in persisted[0].mcpStdioConfig).toBe(false);
    expect(persisted[0].metadata).toEqual({ description: 'kept' });
  });

  it('shows a permission change immediately and rolls it back when rejected', async () => {
    listQuery.mockResolvedValue([connector('c1', 'auto')]);
    await useToolStore.getState().fetchConnectors();

    let rejectWrite!: (error: unknown) => void;
    updateToolPermissionMutation.mockImplementation(
      () => new Promise((_resolve, reject) => (rejectWrite = reject)),
    );

    const operation = useToolStore.getState().updateToolPermission('c1-tool', 'needs_approval');
    // The overlay is visible before the server answers.
    expect(useToolStore.getState().connectors[0].tools[0].permission).toBe('needs_approval');

    rejectWrite(new Error('boom'));
    await operation;
    // The rejected write rebuilt the row from the server value.
    expect(useToolStore.getState().connectors[0].tools[0].permission).toBe('auto');
  });

  it('keeps a deleted connector mounted until the server confirms, then drops it everywhere', async () => {
    listQuery.mockResolvedValue([connector('c1')]);
    listAgentBoundQuery.mockResolvedValue([connector('c1')]);
    listByAgentQuery.mockResolvedValue([connector('c1')]);

    await useToolStore.getState().fetchConnectors();
    await useToolStore.getState().fetchAgentBoundConnectors();
    await useToolStore.getState().fetchAgentConnectors('a1');
    expect(useToolStore.getState().connectors).toHaveLength(1);
    expect(useToolStore.getState().agentBoundConnectors).toHaveLength(1);
    expect(useToolStore.getState().agentConnectors.a1).toHaveLength(1);

    let resolveDelete!: (value: unknown) => void;
    deleteMutation.mockImplementation(() => new Promise((resolve) => (resolveDelete = resolve)));
    const operation = useToolStore.getState().deleteConnector('c1');
    // Still mounted while the request is in flight: the detail pane reads this
    // row, so an optimistic removal would blank it for the whole delete.
    expect(useToolStore.getState().connectors).toHaveLength(1);
    expect(useToolStore.getState().agentBoundConnectors).toHaveLength(1);
    expect(useToolStore.getState().agentConnectors.a1).toHaveLength(1);

    listQuery.mockResolvedValue([]);
    listAgentBoundQuery.mockResolvedValue([]);
    listByAgentQuery.mockResolvedValue([]);
    resolveDelete(undefined);
    await operation;
    // Confirmed: one fan-out drops the row from all three views.
    expect(useToolStore.getState().connectors).toHaveLength(0);
    expect(useToolStore.getState().agentBoundConnectors).toHaveLength(0);
    expect(useToolStore.getState().agentConnectors.a1).toHaveLength(0);
  });

  it('keeps a connector in every list when the delete is rejected', async () => {
    listQuery.mockResolvedValue([connector('c1')]);
    listAgentBoundQuery.mockResolvedValue([connector('c1')]);
    listByAgentQuery.mockResolvedValue([connector('c1')]);

    await useToolStore.getState().fetchConnectors();
    await useToolStore.getState().fetchAgentBoundConnectors();
    await useToolStore.getState().fetchAgentConnectors('a1');

    deleteMutation.mockRejectedValue(new Error('boom'));

    await expect(useToolStore.getState().deleteConnector('c1')).rejects.toThrow('boom');

    expect(useToolStore.getState().connectors.map((c) => c.id)).toEqual(['c1']);
    expect(useToolStore.getState().agentBoundConnectors.map((c) => c.id)).toEqual(['c1']);
    expect(useToolStore.getState().agentConnectors.a1.map((c) => c.id)).toEqual(['c1']);
  });
});

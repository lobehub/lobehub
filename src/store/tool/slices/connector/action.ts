import { isDesktop } from '@lobechat/const';
import { isLocalOrPrivateUrl } from '@lobechat/utils';

import type { ConnectorToolPermission } from '@/database/schemas';
import {
  cacheScope,
  createReplicaSlice,
  linkReplicaEntity,
  type ReplicaLens,
} from '@/libs/replica';
import { lambdaClient } from '@/libs/trpc/client';
import { mcpService } from '@/services/mcp';
import type { StoreSetter } from '@/store/types';

import type { ToolStore } from '../../store';
import {
  agentBoundConnectorsEntity,
  agentBoundConnectorsResource,
  agentConnectorsResource,
  CONNECTOR_LIST_KEY,
  connectorsEntity,
  connectorsResource,
} from './projection';
import type { AgentBoundConnector, ConnectorWithTools } from './types';

type Setter = StoreSetter<ToolStore>;

/** The connector lists are one entry per scope, so every sync shares these params. */
const LIST_PARAMS = {} as Record<string, never>;

/**
 * The base connector list keeps its long-standing flat `connectors` field as
 * the replica view, so every selector keeps reading what it did. The init flag
 * gates `get`: before the first hydrate/replace the view must read `undefined`,
 * otherwise the empty default would block hydration from storage.
 */
const connectorsLens: ReplicaLens<ToolStore, ConnectorWithTools[]> = {
  clear: () => ({ connectors: [], isConnectorsInit: false }),
  get: (state) => (state.isConnectorsInit ? state.connectors : undefined),
  keys: (state) => (state.isConnectorsInit ? [CONNECTOR_LIST_KEY] : []),
  set: (_state, _key, data) =>
    data === undefined
      ? { connectors: [], isConnectorsInit: false }
      : { connectors: data, isConnectorsInit: true },
};

/** The agent-bound aggregate is one entry, gated by `isAgentBoundInit`. */
const agentBoundConnectorsLens: ReplicaLens<ToolStore, AgentBoundConnector[]> = {
  clear: () => ({ agentBoundConnectors: [], isAgentBoundInit: false }),
  get: (state) => (state.isAgentBoundInit ? state.agentBoundConnectors : undefined),
  keys: (state) => (state.isAgentBoundInit ? [CONNECTOR_LIST_KEY] : []),
  set: (_state, _key, data) =>
    data === undefined
      ? { agentBoundConnectors: [], isAgentBoundInit: false }
      : { agentBoundConnectors: data, isAgentBoundInit: true },
};

/**
 * Per-agent lists live in `agentConnectors[agentId]`; the per-agent bucket of
 * `agentConnectorsInit` carries the same gate the flat lists use.
 */
const agentConnectorsLens: ReplicaLens<ToolStore, ConnectorWithTools[]> = {
  clear: () => ({ agentConnectors: {}, agentConnectorsInit: {} }),
  get: (state, key) => (state.agentConnectorsInit[key] ? state.agentConnectors[key] : undefined),
  keys: (state) => Object.keys(state.agentConnectors ?? {}),
  set: (state, key, data) => {
    const agentConnectors = { ...state.agentConnectors };
    const agentConnectorsInit = { ...state.agentConnectorsInit };
    if (data === undefined) {
      delete agentConnectors[key];
      delete agentConnectorsInit[key];
    } else {
      agentConnectors[key] = data;
      agentConnectorsInit[key] = true;
    }
    return { agentConnectors, agentConnectorsInit };
  },
};

/** The connector lists of the active scope (their entry params are constant). */
const fetchConnectorList = (): Promise<ConnectorWithTools[]> =>
  lambdaClient.connector.list.query() as unknown as Promise<ConnectorWithTools[]>;

const fetchAgentBoundConnectorList = (): Promise<AgentBoundConnector[]> =>
  lambdaClient.connector.listAgentBound.query() as unknown as Promise<AgentBoundConnector[]>;

const fetchAgentConnectorList = ({ agentId }: { agentId: string }): Promise<ConnectorWithTools[]> =>
  lambdaClient.connector.listByAgent.query({ agentId }) as unknown as Promise<ConnectorWithTools[]>;

export const createConnectorSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new ConnectorActionImpl(set, get, _api);

/**
 * The connector slice is a set of `@lobechat/replica` resources: the base
 * list, the agent-bound aggregate and the per-agent buckets. The store fields
 * keep their historical shape (`connectors`, `agentBoundConnectors`,
 * `agentConnectors`) as the replica views, so every selector and consumer is
 * unchanged; the slab below only orchestrates fetching and writes.
 */
export class ConnectorActionImpl {
  readonly #agentBoundConnectors;
  readonly #agentConnectors;
  /** One connector lives in the base list, the aggregate and per-agent buckets. */
  readonly #connectorRows;
  readonly #connectors;
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#connectors = createReplicaSlice(connectorsResource, {
      actionPrefix: 'connectors',
      entity: connectorsEntity,
      fetcher: fetchConnectorList,
      get,
      set,
      stateKey: 'connectorsReplica',
      view: connectorsLens,
    });
    this.#agentBoundConnectors = createReplicaSlice(agentBoundConnectorsResource, {
      actionPrefix: 'agentBoundConnectors',
      entity: agentBoundConnectorsEntity,
      fetcher: fetchAgentBoundConnectorList,
      get,
      set,
      stateKey: 'agentBoundConnectorsReplica',
      view: agentBoundConnectorsLens,
    });
    this.#agentConnectors = createReplicaSlice(agentConnectorsResource, {
      actionPrefix: 'agentConnectors',
      entity: connectorsEntity,
      fetcher: fetchAgentConnectorList,
      get,
      set,
      stateKey: 'agentConnectorsReplica',
      view: agentConnectorsLens,
    });
    this.#connectorRows = linkReplicaEntity<ConnectorWithTools>([
      this.#connectors,
      this.#agentBoundConnectors,
      this.#agentConnectors,
    ]);
  }

  /**
   * Refresh the base connector list. The persisted projection paints as soon
   * as it is read while the network confirms it in parallel, instead of
   * blanking to an empty array first.
   *
   * The identity scope is captured when the request is issued and handed to
   * `hydrate` / `replace` explicitly, because the replica reads the *active*
   * scope at call time — i.e. after the response has already landed. A response
   * that resolves after the scope moved on is then dropped by the replica
   * itself (`dispatch` discards actions whose scope is no longer active),
   * instead of being written into the next identity's partition.
   *
   * The whole cache scope (user + workspace) is captured, not just the
   * workspace: two different signed-in users in personal context both have a
   * `null` workspace, so a workspace-only guard cannot tell them apart and
   * would store user A's connector inventory in user B's partition after an
   * account switch. Booting straight into a workspace URL is the other case
   * this covers — the tree mounts once in personal context before the URL→store
   * sync resolves the slug, so a personal `list` query is already in flight
   * when the workspace switch fires its own, and the personal one landing last
   * is what made a business workspace list the user's PERSONAL tools.
   *
   * Dropping a response deliberately leaves the one-shot init flag alone
   * rather than marking the bucket loaded: a scope change remounts the
   * workspace context slot's subtree, so the consumers gated on that flag
   * re-issue their fetch under the new scope and the discarded result is not
   * one anybody still needs.
   */
  fetchConnectors = async (): Promise<void> => {
    const scope = cacheScope.get();
    const pending = this.#connectors.fetcher!(LIST_PARAMS);
    if (!this.#get().isConnectorsInit) await this.#connectors.hydrate(LIST_PARAMS, scope);
    const data = await pending;
    this.#connectors.replace(LIST_PARAMS, data, scope);
  };

  /**
   * Refresh the connector lists after a mutation. Always refreshes the base
   * list; also refreshes the agent-bound aggregate when it has been loaded (the
   * unified settings page), so a connector-detail action on an agent connector
   * (delete / sync / permission reset) updates that list too. On base-only
   * pages `isAgentBoundInit` is false, so this stays a single query.
   */
  #refreshConnectorLists = async (): Promise<void> => {
    const tasks = [this.fetchConnectors()];
    if (this.#get().isAgentBoundInit) tasks.push(this.fetchAgentBoundConnectors());
    await Promise.all(tasks);
  };

  /**
   * Fetch every agent-owned connector across all agents (the flat aggregate for
   * the unified connector-settings page). Each row is enriched
   * server-side with the owning agent's title/avatar. Scope-correct: a workspace
   * context only returns that workspace's agent connectors. See
   * {@link ConnectorActionImpl.fetchConnectors} for the captured-scope rule.
   */
  fetchAgentBoundConnectors = async (): Promise<void> => {
    const scope = cacheScope.get();
    const pending = this.#agentBoundConnectors.fetcher!(LIST_PARAMS);
    if (!this.#get().isAgentBoundInit) await this.#agentBoundConnectors.hydrate(LIST_PARAMS, scope);
    const data = await pending;
    this.#agentBoundConnectors.replace(LIST_PARAMS, data, scope);
  };

  /**
   * Fetch an agent's own tools (agent-owned + mounted) for the "Agent Tools"
   * tab. Stored keyed by agentId. See
   * {@link ConnectorActionImpl.fetchConnectors} for the captured-scope rule.
   */
  fetchAgentConnectors = async (agentId: string): Promise<void> => {
    const scope = cacheScope.get();
    const params = { agentId };
    const pending = this.#agentConnectors.fetcher!(params);
    if (!this.#get().agentConnectorsInit[agentId])
      await this.#agentConnectors.hydrate(params, scope);
    const data = await pending;
    this.#agentConnectors.replace(params, data, scope);
  };

  /** Copy a user connector into an agent-owned, independently editable row. */
  copyConnectorToAgent = async (connectorId: string, agentId: string): Promise<string> => {
    const { id } = await lambdaClient.connector.copyToAgent.mutate({ agentId, connectorId });
    await this.fetchAgentConnectors(agentId);
    return id;
  };

  /** Mount (reference + lock) a user connector onto an agent. */
  mountConnectorToAgent = async (connectorId: string, agentId: string): Promise<void> => {
    await lambdaClient.connector.mountToAgent.mutate({ agentId, connectorId });
    await Promise.all([this.fetchAgentConnectors(agentId), this.fetchConnectors()]);
  };

  /** Unmount / detach a connector from an agent (unmounts or deletes the agent row). */
  detachConnectorFromAgent = async (
    connectorId: string,
    agentId: string,
    mode: 'unmount' | 'delete',
  ): Promise<void> => {
    if (mode === 'unmount') {
      await lambdaClient.connector.unmountFromAgent.mutate({ connectorId });
    } else {
      await lambdaClient.connector.delete.mutate({ id: connectorId });
    }
    await Promise.all([this.fetchAgentConnectors(agentId), this.fetchConnectors()]);
  };

  /**
   * Fetch the connector with its decrypted user-set credentials for the edit
   * form. Does NOT update the store — caller uses the result directly.
   * Machine-managed OAuth tokens are excluded server-side.
   */
  getConnectorForEdit = async (id: string) => {
    return lambdaClient.connector.getForEdit.query({ id });
  };

  /**
   * Create (or idempotently update) a connector. `isNew` is the server's
   * knowledge of whether the row was freshly created — callers that roll back
   * on a later sync failure must use it instead of a client-side cache check,
   * which is unreliable before `fetchConnectors` has completed.
   */
  createConnector = async (
    params: Parameters<typeof lambdaClient.connector.create.mutate>[0],
  ): Promise<{ id: string; isNew: boolean }> => {
    this.#set({ connectorCreating: true }, false, 'createConnector/start');
    try {
      const created = await lambdaClient.connector.create.mutate(params);
      await this.fetchConnectors();
      return { id: created.id, isNew: created.isNew };
    } finally {
      this.#set({ connectorCreating: false }, false, 'createConnector/end');
    }
  };

  /**
   * Begin the OAuth authorization-code flow for a custom connector and return
   * the authorize URL for the caller to open in a popup. Resolves the client
   * via pre-registration or DCR on the server.
   */
  startConnectorOAuth = async (id: string): Promise<string> => {
    const { authorizationUrl } = await lambdaClient.connector.startOAuth.mutate({ id });
    return authorizationUrl;
  };

  /**
   * Delete a connector. The row leaves every list that holds it (base,
   * agent-bound and per-agent buckets) in one fan-out — but only once the
   * server has confirmed the delete. The row must stay mounted while the
   * request is in flight: a detail pane bound to it would otherwise blank for
   * every deletion (and blink back if the delete is rejected), which is why the
   * removal is confirmed rather than optimistic.
   */
  deleteConnector = async (id: string): Promise<void> => {
    await lambdaClient.connector.delete.mutate({ id });
    this.#connectorRows.remove(id);
    await this.#refreshConnectorLists();
  };

  updateConnector = async (
    id: string,
    patch: {
      credentials?:
        | { token: string; type: 'bearer' }
        | { headers: Record<string, string>; type: 'header' }
        | null;
      isEnabled?: boolean;
      mcpServerUrl?: string;
      metadata?: Record<string, unknown>;
      name?: string;
      oidcConfig?: {
        clientId?: string;
        clientSecret?: string;
        scheme?: 'pre_registration' | 'dcr' | 'client_id_metadata_document';
      };
    },
  ): Promise<void> => {
    await lambdaClient.connector.update.mutate({ id, patch: patch as any });
    await this.#refreshConnectorLists();
  };

  syncConnectorTools = async (id: string): Promise<void> => {
    this.#set(
      (s) => ({ connectorSyncing: { ...s.connectorSyncing, [id]: true } }),
      false,
      'syncConnectorTools/start',
    );
    try {
      const syncedLocally = await this.#syncLocalConnectorTools(id);
      if (!syncedLocally) await lambdaClient.connector.syncTools.mutate({ id });
      await this.#refreshConnectorLists();
    } finally {
      this.#set(
        (s) => ({ connectorSyncing: { ...s.connectorSyncing, [id]: false } }),
        false,
        'syncConnectorTools/end',
      );
    }
  };

  /**
   * Desktop-only install/refresh path for connectors the cloud server cannot
   * reach itself: stdio MCP (must spawn on this machine) and local/private
   * network HTTP endpoints. The server-side `syncTools` would try to connect
   * FROM the cloud and fail with "Failed to start MCP service process" /
   * "fetch failed" (#16533), so the client lists the tools locally (via the
   * Electron main process, same path Test Connection uses) and reports them
   * through `syncToolsFromClientById`.
   *
   * Returns false when the connector is server-reachable (public HTTP) or when
   * not running in desktop — the caller falls back to the server-side sync.
   */
  #syncLocalConnectorTools = async (id: string): Promise<boolean> => {
    if (!isDesktop) return false;

    // `getForEdit` returns the decrypted user-set credentials (bearer/apikey/
    // header) needed to connect locally. OAuth2 tokens are machine-managed and
    // never leave the server — but OAuth against a localhost endpoint would be
    // server-unreachable anyway, so that combination stays on the server path.
    const detail = await lambdaClient.connector.getForEdit.query({ id });
    const isStdio = detail.mcpConnectionType === 'stdio';
    const isLocalHttp = !!detail.mcpServerUrl && isLocalOrPrivateUrl(detail.mcpServerUrl);
    if (!isStdio && !isLocalHttp) return false;

    let api: Array<{ description?: string; name: string; parameters?: Record<string, unknown> }>;
    if (isStdio) {
      if (!detail.mcpStdioConfig?.command) throw new Error('Connector is missing stdio config');
      const manifest = await mcpService.getStdioMcpServerManifest({
        args: detail.mcpStdioConfig.args ?? [],
        command: detail.mcpStdioConfig.command,
        env: detail.mcpStdioConfig.env ?? undefined,
        name: detail.identifier,
      });
      api = manifest.api ?? [];
    } else {
      const credentials = detail.credentials;
      const auth =
        credentials?.type === 'bearer'
          ? { token: credentials.token, type: 'bearer' as const }
          : credentials?.type === 'apikey'
            ? { token: credentials.apiKey, type: 'bearer' as const }
            : undefined;
      // Custom headers live in metadata.customHeaders; legacy rows stored them
      // as a 'header' credential — merge both, mirroring the server-side
      // buildConnectorMcpParams.
      const headerCreds = credentials?.type === 'header' ? credentials.headers : undefined;
      const customHeaders = detail.metadata?.customHeaders as Record<string, string> | undefined;
      const headers =
        headerCreds || customHeaders ? { ...headerCreds, ...customHeaders } : undefined;
      const manifest = await mcpService.getStreamableMcpServerManifest({
        auth,
        headers,
        identifier: detail.identifier,
        url: detail.mcpServerUrl!,
      });
      api = manifest.api ?? [];
    }

    await lambdaClient.connector.syncToolsFromClientById.mutate({
      id,
      tools: api.map((a) => ({
        description: a.description,
        inputSchema: a.parameters,
        toolName: a.name,
      })),
    });
    return true;
  };

  disconnectConnector = async (id: string): Promise<void> => {
    await lambdaClient.connector.update.mutate({
      id,
      patch: { isEnabled: false },
    });
    await this.#refreshConnectorLists();
  };

  /**
   * Reset all tool permissions for a connector back to 'auto' (fully open).
   */
  resetConnectorPermissions = async (id: string): Promise<void> => {
    await lambdaClient.connector.resetPermissions.mutate({ id });
    await this.#refreshConnectorLists();
  };

  /**
   * Sync tools from a client-provided list (for Lobehub OAuth skills / Composio
   * that already have their tool list available on the client side).
   * Idempotent — safe to call whenever the detail panel opens.
   */
  syncToolsFromClient = async (params: {
    identifier: string;
    name: string;
    sourceType: 'builtin' | 'custom' | 'marketplace';
    tools: Array<{ description?: string; inputSchema?: Record<string, unknown>; toolName: string }>;
  }): Promise<string> => {
    const result = await lambdaClient.connector.syncToolsFromClient.mutate(params);
    await this.fetchConnectors();
    return result.connectorId;
  };

  /**
   * Bootstrap connector entry for a builtin tool (reads manifest server-side).
   * Idempotent — safe to call whenever the detail panel opens.
   * Returns the connectorId.
   */
  syncBuiltinTool = async (identifier: string): Promise<string> => {
    const result = await lambdaClient.connector.syncBuiltinTool.mutate({ identifier });
    await this.fetchConnectors();
    return result.connectorId;
  };

  /**
   * Bootstrap connector entry for an installed marketplace plugin.
   * Idempotent — safe to call whenever the detail panel opens.
   * Returns the connectorId, or `null` for legacy customPlugin rows that own
   * an MCP endpoint (those go through the frontend migration flow instead).
   */
  syncPluginTools = async (identifier: string): Promise<string | null> => {
    const result = await lambdaClient.connector.syncPluginTools.mutate({ identifier });
    await this.fetchConnectors();
    return result.connectorId;
  };

  updateToolPermission = async (
    toolId: string,
    permission: ConnectorToolPermission,
  ): Promise<void> => {
    // Optimistic update — patch the tool in whichever list holds it. The base
    // list and the agent-bound aggregate are separate replicas, so each gets
    // its own overlay and both settle together.
    const patchTools = <
      T extends { tools: Array<{ id: string; permission: ConnectorToolPermission }> },
    >(
      list: T[],
    ): T[] =>
      list.map((c) => ({
        ...c,
        tools: c.tools.map((t) => (t.id === toolId ? { ...t, permission } : t)),
      }));

    const base = this.#connectors.beginOptimistic(CONNECTOR_LIST_KEY, patchTools);
    const bound = this.#agentBoundConnectors.beginOptimistic(CONNECTOR_LIST_KEY, patchTools);

    try {
      await lambdaClient.connector.updateToolPermission.mutate({ permission, toolId });
      base.commit();
      bound.commit();
    } catch {
      // Roll back the overlays, then rebuild from the server.
      base.rollback();
      bound.rollback();
      await this.#refreshConnectorLists();
    }
  };
}

export type ConnectorAction = Pick<ConnectorActionImpl, keyof ConnectorActionImpl>;

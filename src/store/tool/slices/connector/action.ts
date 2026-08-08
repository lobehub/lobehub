import { isDesktop } from '@lobechat/const';
import { isLocalOrPrivateUrl } from '@lobechat/utils';

import type { ConnectorToolPermission } from '@/database/schemas';
import { lambdaClient } from '@/libs/trpc/client';
import { mcpService } from '@/services/mcp';
import type { StoreSetter } from '@/store/types';

import type { ToolStore } from '../../store';

type Setter = StoreSetter<ToolStore>;

export const createConnectorSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new ConnectorActionImpl(set, get, _api);

export class ConnectorActionImpl {
  readonly #set: Setter;
  readonly #get: () => ToolStore;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  fetchConnectors = async (): Promise<void> => {
    const data = await lambdaClient.connector.list.query();
    this.#set({ connectors: data as any, isConnectorsInit: true }, false, 'fetchConnectors');
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
   * context only returns that workspace's agent connectors.
   */
  fetchAgentBoundConnectors = async (): Promise<void> => {
    const data = await lambdaClient.connector.listAgentBound.query();
    this.#set(
      { agentBoundConnectors: data as any, isAgentBoundInit: true },
      false,
      'fetchAgentBoundConnectors',
    );
  };

  /**
   * Fetch an agent's own tools (agent-owned + mounted) for the "Agent Tools"
   * tab. Stored keyed by agentId.
   */
  fetchAgentConnectors = async (agentId: string): Promise<void> => {
    const data = await lambdaClient.connector.listByAgent.query({ agentId });
    this.#set(
      (s) => ({
        agentConnectors: { ...s.agentConnectors, [agentId]: data as any },
        agentConnectorsInit: { ...s.agentConnectorsInit, [agentId]: true },
      }),
      false,
      'fetchAgentConnectors',
    );
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

  deleteConnector = async (id: string): Promise<void> => {
    await lambdaClient.connector.delete.mutate({ id });
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
    // Optimistic update — patch the tool in whichever list holds it (base
    // connectors and agent-bound connectors are separate arrays).
    const patchTools = <
      T extends { tools: Array<{ id: string; permission: ConnectorToolPermission }> },
    >(
      list: T[],
    ): T[] =>
      list.map((c) => ({
        ...c,
        tools: c.tools.map((t) => (t.id === toolId ? { ...t, permission } : t)),
      }));
    this.#set(
      (s) => ({
        agentBoundConnectors: patchTools(s.agentBoundConnectors ?? []),
        connectors: patchTools(s.connectors),
      }),
      false,
      'updateToolPermission/optimistic',
    );

    try {
      await lambdaClient.connector.updateToolPermission.mutate({ permission, toolId });
    } catch {
      // Roll back on error
      await this.#refreshConnectorLists();
    }
  };
}

export type ConnectorAction = Pick<ConnectorActionImpl, keyof ConnectorActionImpl>;

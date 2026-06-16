import type { ConnectorToolPermission } from '@/database/schemas';
import { lambdaClient } from '@/libs/trpc/client';
import type { StoreSetter } from '@/store/types';

import type { ToolStore } from '../../store';

type Setter = StoreSetter<ToolStore>;

export const createConnectorSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new ConnectorActionImpl(set, get, _api);

export class ConnectorActionImpl {
  readonly #set: Setter;

  constructor(set: Setter, _get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
  }

  fetchConnectors = async (): Promise<void> => {
    const data = await lambdaClient.connector.list.query();
    this.#set({ connectors: data as any, isConnectorsInit: true }, false, 'fetchConnectors');
  };

  /**
   * Fetch the connector with its decrypted user-set credentials for the edit
   * form. Does NOT update the store — caller uses the result directly.
   * Machine-managed OAuth tokens are excluded server-side.
   */
  getConnectorForEdit = async (id: string) => {
    return lambdaClient.connector.getForEdit.query({ id });
  };

  createConnector = async (
    params: Parameters<typeof lambdaClient.connector.create.mutate>[0],
  ): Promise<string> => {
    this.#set({ connectorCreating: true }, false, 'createConnector/start');
    try {
      const created = await lambdaClient.connector.create.mutate(params);
      await this.fetchConnectors();
      return created.id;
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
    await this.fetchConnectors();
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
      name?: string;
      oidcConfig?: {
        clientId?: string;
        clientSecret?: string;
        scheme?: 'pre_registration' | 'dcr' | 'client_id_metadata_document';
      };
    },
  ): Promise<void> => {
    await lambdaClient.connector.update.mutate({ id, patch: patch as any });
    await this.fetchConnectors();
  };

  syncConnectorTools = async (id: string): Promise<void> => {
    this.#set(
      (s) => ({ connectorSyncing: { ...s.connectorSyncing, [id]: true } }),
      false,
      'syncConnectorTools/start',
    );
    try {
      await lambdaClient.connector.syncTools.mutate({ id });
      await this.fetchConnectors();
    } finally {
      this.#set(
        (s) => ({ connectorSyncing: { ...s.connectorSyncing, [id]: false } }),
        false,
        'syncConnectorTools/end',
      );
    }
  };

  disconnectConnector = async (id: string): Promise<void> => {
    await lambdaClient.connector.update.mutate({
      id,
      patch: { isEnabled: false },
    });
    await this.fetchConnectors();
  };

  /**
   * Reset all tool permissions for a connector back to 'auto' (fully open).
   */
  resetConnectorPermissions = async (id: string): Promise<void> => {
    await lambdaClient.connector.resetPermissions.mutate({ id });
    await this.fetchConnectors();
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
   * Returns the connectorId.
   */
  syncPluginTools = async (identifier: string): Promise<string> => {
    const result = await lambdaClient.connector.syncPluginTools.mutate({ identifier });
    await this.fetchConnectors();
    return result.connectorId;
  };

  updateToolPermission = async (
    toolId: string,
    permission: ConnectorToolPermission,
  ): Promise<void> => {
    // Optimistic update
    this.#set(
      (s) => ({
        connectors: s.connectors.map((c) => ({
          ...c,
          tools: c.tools.map((t) => (t.id === toolId ? { ...t, permission } : t)),
        })),
      }),
      false,
      'updateToolPermission/optimistic',
    );

    try {
      await lambdaClient.connector.updateToolPermission.mutate({ permission, toolId });
    } catch {
      // Roll back on error
      await this.fetchConnectors();
    }
  };
}

export type ConnectorAction = Pick<ConnectorActionImpl, keyof ConnectorActionImpl>;

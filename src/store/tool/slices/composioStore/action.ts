import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { produce } from 'immer';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { lambdaClient, toolsClient } from '@/libs/trpc/client';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type ComposioStoreState } from './initialState';
import {
  COMPOSIO_SERVERS_KEY,
  composioAppToolsResource,
  composioServersEntity,
  composioServersResource,
} from './projection';
import {
  type CallComposioToolParams,
  type CallComposioToolResult,
  type ComposioServer,
  ComposioServerStatus,
  type ComposioTool,
  type CreateComposioServerParams,
} from './types';

const n = setNamespace('composioStore');

const VALID_COMPOSIO_IDENTIFIERS = new Set(COMPOSIO_APP_TYPES.map((t) => t.identifier));

/** The connections list is one entry, so every sync shares these params. */
const CONNECTIONS_PARAMS = {} as Record<string, never>;

/**
 * The connections list keeps its long-standing flat `composioServers` field as
 * the replica view, so every selector reads what it did. `isComposioServersInit`
 * gates `get`: before the first hydrate/replace the view must read `undefined`,
 * otherwise the empty default would block hydration from storage.
 */
const composioServersLens: ReplicaLens<ToolStore, ComposioServer[]> = {
  clear: () => ({ composioServers: [], isComposioServersInit: false }),
  get: (state) => (state.isComposioServersInit ? state.composioServers : undefined),
  keys: (state) => (state.isComposioServersInit ? [COMPOSIO_SERVERS_KEY] : []),
  set: (_state, _key, data) =>
    data
      ? { composioServers: data, isComposioServersInit: true }
      : { composioServers: [], isComposioServersInit: false },
};

/** The connections sync, plus the `mutate` alias the skills reload control calls. */
export interface ComposioConnectionsSyncResult extends ReplicaSyncResult {
  /** Alias of `revalidate`, kept for the existing "reload skills" control. */
  mutate: () => Promise<unknown>;
}

type Setter = StoreSetter<ToolStore>;
export const createComposioStoreSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new ComposioStoreActionImpl(set, get, _api);

export class ComposioStoreActionImpl {
  readonly #appTools;
  readonly #connections;
  readonly #get: () => ToolStore;
  readonly #servers;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#connections = createReplicaSlice(composioServersResource, {
      actionPrefix: 'composioServers',
      entity: composioServersEntity,
      fetcher: () => this.#fetchServers(),
      get,
      set,
      stateKey: 'composioServersReplica',
      view: composioServersLens,
    });
    this.#servers = linkReplicaEntity<ComposioServer>([this.#connections]);
    this.#appTools = createReplicaSlice(composioAppToolsResource, {
      actionPrefix: 'composioAppTools',
      fetcher: async (appSlug) => {
        const response = await toolsClient.composio.getActions.query({ appSlug });
        return (response.tools || []) as ComposioTool[];
      },
      get,
      set,
      stateKey: 'composioAppToolsReplica',
      view: recordLens<ToolStore, ComposioTool[]>('composioAppToolsMap'),
    });
  }

  callComposioTool = async (params: CallComposioToolParams): Promise<CallComposioToolResult> => {
    const { identifier, toolSlug, toolArgs } = params;

    const toolId = `${identifier}:${toolSlug}`;

    this.#set(
      produce((draft: ComposioStoreState) => {
        draft.composioExecutingToolIds.add(toolId);
      }),
      false,
      n('callComposioTool/start'),
    );

    try {
      const response = await toolsClient.composio.executeAction.mutate({
        identifier,
        toolArgs,
        toolSlug,
      });

      this.#set(
        produce((draft: ComposioStoreState) => {
          draft.composioExecutingToolIds.delete(toolId);
        }),
        false,
        n('callComposioTool/success'),
      );

      return { data: response, success: true };
    } catch (error) {
      console.error('[Composio] Failed to call tool:', error);

      this.#set(
        produce((draft: ComposioStoreState) => {
          draft.composioExecutingToolIds.delete(toolId);
        }),
        false,
        n('callComposioTool/error'),
      );

      return {
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  };

  completeComposioServerAuth = async (identifier: string): Promise<void> => {
    await this.#get().refreshComposioConnectionStatus(identifier);
  };

  createComposioConnection = async (
    params: CreateComposioServerParams,
  ): Promise<ComposioServer | undefined> => {
    const { appSlug, identifier, label, agentId } = params;

    this.#set(
      produce((draft: ComposioStoreState) => {
        draft.loadingComposioServerIds.add(identifier);
      }),
      false,
      n('createComposioConnection/start'),
    );

    try {
      const response = await lambdaClient.composio.createConnection.mutate({
        agentId,
        appSlug,
        identifier,
        label,
      });

      const server: ComposioServer = {
        agentId,
        appSlug,
        authConfigId: response.authConfigId,
        connectedAccountId: response.connectedAccountId,
        createdAt: 0,
        identifier: response.identifier,
        label,
        redirectUrl: response.redirectUrl,
        status: ComposioServerStatus.PENDING_AUTH,
      };

      // Replace the record in place (by identifier) or append the new one, so a
      // re-authorization keeps showing the same row with a fresh `redirectUrl`.
      this.#connections.update(COMPOSIO_SERVERS_KEY, (servers) => {
        const list = servers ?? [];
        const index = list.findIndex((s) => s.identifier === identifier);
        if (index < 0) return [...list, server];
        return list.map((s, i) => (i === index ? server : s));
      });

      this.#set(
        produce((draft: ComposioStoreState) => {
          draft.loadingComposioServerIds.delete(identifier);
        }),
        false,
        n('createComposioConnection/success'),
      );

      return server;
    } catch (error) {
      console.error('[Composio] Failed to create connection:', error);

      this.#set(
        produce((draft: ComposioStoreState) => {
          draft.loadingComposioServerIds.delete(identifier);
        }),
        false,
        n('createComposioConnection/error'),
      );

      return undefined;
    }
  };

  refreshComposioConnectionStatus = async (identifier: string): Promise<void> => {
    const { composioServers } = this.#get();

    const server = composioServers.find((s) => s.identifier === identifier);
    if (!server) {
      console.error('[Composio] Server not found:', identifier);
      return;
    }

    this.#set(
      produce((draft: ComposioStoreState) => {
        draft.loadingComposioServerIds.add(identifier);
      }),
      false,
      n('refreshComposioConnectionStatus/start'),
    );

    try {
      const connectionStatus = await lambdaClient.composio.getConnection.query({
        connectedAccountId: server.connectedAccountId,
      });

      if (connectionStatus.error === 'AUTH_ERROR') {
        this.#set(
          produce((draft: ComposioStoreState) => {
            draft.loadingComposioServerIds.delete(identifier);
          }),
          false,
          n('refreshComposioConnectionStatus/pendingAuth'),
        );
        return;
      }

      if (connectionStatus.status !== 'ACTIVE') {
        this.#set(
          produce((draft: ComposioStoreState) => {
            draft.loadingComposioServerIds.delete(identifier);
          }),
          false,
          n('refreshComposioConnectionStatus/notActive'),
        );
        return;
      }

      // ACTIVE — fetch tools
      const toolsResponse = await toolsClient.composio.listActions.query({
        appSlug: server.appSlug,
      });

      const tools = toolsResponse.tools as ComposioTool[];

      this.#servers.update(identifier, (s) => ({
        ...s,
        errorMessage: undefined,
        gmailReadPermission: connectionStatus.gmailReadPermission,
        redirectUrl: undefined,
        status: ComposioServerStatus.ACTIVE,
        tools,
      }));

      this.#set(
        produce((draft: ComposioStoreState) => {
          draft.loadingComposioServerIds.delete(identifier);
        }),
        false,
        n('refreshComposioConnectionStatus/success'),
      );

      await lambdaClient.composio.updateComposioPlugin.mutate({
        agentId: server.agentId,
        appSlug: server.appSlug,
        authConfigId: server.authConfigId,
        connectedAccountId: server.connectedAccountId,
        identifier,
        label: server.label,
        status: 'ACTIVE',
        tools: tools.map((t) => ({
          description: t.description,
          inputSchema: t.inputSchema,
          name: t.name,
        })),
      });
    } catch (error) {
      console.error('[Composio] Failed to refresh connection status:', error);

      this.#servers.update(identifier, (s) => ({
        ...s,
        errorMessage: error instanceof Error ? error.message : String(error),
        status: ComposioServerStatus.ERROR,
      }));

      this.#set(
        produce((draft: ComposioStoreState) => {
          draft.loadingComposioServerIds.delete(identifier);
        }),
        false,
        n('refreshComposioConnectionStatus/error'),
      );
    }
  };

  reauthorizeComposioConnection = async (
    identifier: string,
  ): Promise<ComposioServer | undefined> => {
    const { composioServers } = this.#get();
    const existing = composioServers.find((s) => s.identifier === identifier);
    if (!existing) return undefined;

    // Clean up the stale connection on Composio's side (the prior link likely
    // expired). Best-effort — if it's already gone we still mint a fresh one.
    try {
      await lambdaClient.composio.deleteConnection.mutate({
        connectedAccountId: existing.connectedAccountId,
        identifier,
      });
    } catch (error) {
      console.error('[Composio] Failed to clean up stale connection:', error);
    }

    // Mint a fresh link; createComposioConnection replaces the record in place
    // (by identifier), so the UI keeps showing the same row with a new redirectUrl.
    return this.#get().createComposioConnection({
      appSlug: existing.appSlug,
      identifier,
      label: existing.label,
    });
  };

  removeComposioConnection = async (identifier: string): Promise<void> => {
    const { composioServers } = this.#get();
    const server = composioServers.find((s) => s.identifier === identifier);

    // Drop the row locally first — the server delete stays best-effort, so a
    // failure never resurrects the row the user just deleted.
    this.#servers.remove(identifier);

    if (server) {
      try {
        await lambdaClient.composio.deleteConnection.mutate({
          connectedAccountId: server.connectedAccountId,
          identifier,
        });
      } catch (error) {
        console.error('[Composio] Failed to delete connection:', error);
      }
    }
  };

  /**
   * Fetch orchestration only; read the tools through `composioAppToolsMap[appSlug]`.
   * Deliberately does not subscribe to the store here — the composio slice is
   * imported by `tool/selectors/tool.ts`, so a runtime `useToolStore` import
   * would close a store↔slice cycle and break store initialization.
   */
  useFetchAppTools = (appSlug: string | undefined): ReplicaSyncResult =>
    this.#appTools.useSync(appSlug ?? null);

  /** Fetch orchestration only; read the servers through `composioStoreSelectors`'. */
  useFetchUserComposioConnections = (enabled: boolean): ComposioConnectionsSyncResult => {
    const sync = this.#connections.useSync(CONNECTIONS_PARAMS, { enabled });

    return { ...sync, mutate: sync.revalidate };
  };

  /**
   * The user's Composio connections (`getComposioPlugins`), mapped to the
   * renderable catalog. Identifiers outside the static catalog are hidden
   * locally — never deleted: an outdated bundle (missing a newly-added app)
   * would otherwise silently destroy a legitimate remote connection. Deprecating
   * an app is a server-side concern, not a side effect of a client fetch.
   */
  #fetchServers = async (): Promise<ComposioServer[]> => {
    const composioPlugins = await lambdaClient.composio.getComposioPlugins.query();

    if (composioPlugins.length === 0) return [];

    return composioPlugins
      .filter((plugin) => plugin.customParams?.composio)
      .filter((plugin) => VALID_COMPOSIO_IDENTIFIERS.has(plugin.identifier))
      .map((plugin) => {
        const params = plugin.customParams!.composio!;
        const appType = COMPOSIO_APP_TYPES.find((t) => t.identifier === plugin.identifier);
        const tools: ComposioTool[] = (plugin.manifest?.api || []).map((api) => ({
          description: api.description,
          inputSchema: api.parameters as ComposioTool['inputSchema'],
          name: api.name,
        }));

        const statusMap: Record<string, ComposioServerStatus> = {
          ACTIVE: ComposioServerStatus.ACTIVE,
          FAILED: ComposioServerStatus.ERROR,
          PENDING: ComposioServerStatus.PENDING_AUTH,
        };

        return {
          appSlug: params.appSlug || '',
          authConfigId: params.authConfigId || '',
          connectedAccountId: params.connectedAccountId,
          createdAt: 0,
          identifier: plugin.identifier,
          label: appType?.label || plugin.identifier,
          redirectUrl: params.redirectUrl,
          status: statusMap[params.status] || ComposioServerStatus.PENDING_AUTH,
          tools,
        };
      });
  };
}

export type ComposioStoreAction = Pick<ComposioStoreActionImpl, keyof ComposioStoreActionImpl>;

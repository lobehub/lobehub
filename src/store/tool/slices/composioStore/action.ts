import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { produce } from 'immer';

import {
  cacheScope,
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
  type ComposioLocalIntent,
  composioServersEntity,
  composioServersResource,
  createComposioLocalIntent,
  mergeComposioServers,
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
  #intent = createComposioLocalIntent();
  #intentScope?: string;
  readonly #servers;
  readonly #set: Setter;
  /**
   * Confirmed local writes to the connections list, per replica scope. A
   * `getComposioPlugins` request stamps itself with its scope's value on start;
   * a response stamped before that scope's latest write is dropped (see
   * `mergeComposioServers`), so an in-flight sync can never roll a confirmed
   * connect / delete / status refresh back. Kept per scope, not process-wide: a
   * write one identity still owes must not drop another identity's responses,
   * which would leave the switched-to scope empty until some later revalidation.
   */
  #writeSeqByScope = new Map<string, number>();
  /**
   * Local writes whose server persistence is still in flight, per replica scope.
   * A `getComposioPlugins` the server answers while one is pending still reflects
   * the pre-write row (the refresh's `ACTIVE` row is only persisted by
   * `updateComposioPlugin` below), so every response is dropped until it settles
   * — the stamp alone cannot tell such a response from a fresh one, because its
   * request was issued *after* the local write. Scoped for the same reason as
   * `#writeSeqByScope`.
   */
  #unpersistedWritesByScope = new Map<string, number>();

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#connections = createReplicaSlice(composioServersResource, {
      actionPrefix: 'composioServers',
      entity: composioServersEntity,
      // Stamp the request with the write sequence in flight when it starts, so
      // `merge` can drop a response the server produced before a later write.
      fetcher: async () => {
        const since = this.#writeSeq();
        const servers = await this.#fetchServers();
        return { servers, since };
      },
      get,
      // A list response replaces the whole value; a response issued before the
      // latest local write — or while one is still being persisted — is dropped,
      // and one that clears both is still merged with the local intent (a new
      // connection the server has not echoed, a deletion it has not confirmed)
      // so an in-flight sync can neither drop a new connection nor resurrect a
      // deleted one.
      merge: (response) =>
        mergeComposioServers(
          response,
          this.#localIntent(),
          this.#writeSeq(),
          this.#hasUnpersistedWrite(),
        ),
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
    // The completion is bound to the identity that started it: the server may
    // answer after the user switched scope (see the guard below).
    const scope = cacheScope.get();

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

      // The user may have switched identity while the server answered. Writing
      // the row now would persist this scope's connected-account id and OAuth
      // redirect url into the other scope's replica partition, and show them
      // there; drop the completion instead.
      if (cacheScope.get() !== scope) {
        this.#set(
          produce((draft: ComposioStoreState) => {
            draft.loadingComposioServerIds.delete(identifier);
          }),
          false,
          n('createComposioConnection/scopeChanged'),
        );
        return undefined;
      }

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
      // The intent survives a list response that was already in flight when the
      // connection was created (see `mergeComposioServers`); a pending removal
      // of the same identifier is cleared, since the row is back.
      this.#localIntent().removed.delete(identifier);
      this.#localIntent().added.set(identifier, server);
      this.#connections.update(COMPOSIO_SERVERS_KEY, (servers) => {
        const list = servers ?? [];
        const index = list.findIndex((s) => s.identifier === identifier);
        if (index < 0) return [...list, server];
        return list.map((s, i) => (i === index ? server : s));
      });
      this.#markLocalWrite();

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

    // This refresh is bound to the identity that started it: the server may
    // answer after the user switched scope, and this row is that scope's (see
    // the guards below).
    const scope = cacheScope.get();
    const clearLoading = (action: string) =>
      this.#set(
        produce((draft: ComposioStoreState) => {
          draft.loadingComposioServerIds.delete(identifier);
        }),
        false,
        n(action),
      );

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

      // Identity switched while the server answered: nothing below may touch
      // the now-active list.
      if (cacheScope.get() !== scope) {
        clearLoading('refreshComposioConnectionStatus/scopeChanged');
        return;
      }

      if (connectionStatus.error === 'AUTH_ERROR') {
        clearLoading('refreshComposioConnectionStatus/pendingAuth');
        return;
      }

      if (connectionStatus.status !== 'ACTIVE') {
        clearLoading('refreshComposioConnectionStatus/notActive');
        return;
      }

      // ACTIVE — fetch tools
      const toolsResponse = await toolsClient.composio.listActions.query({
        appSlug: server.appSlug,
      });

      if (cacheScope.get() !== scope) {
        clearLoading('refreshComposioConnectionStatus/scopeChanged');
        return;
      }

      const tools = toolsResponse.tools as ComposioTool[];

      this.#servers.update(identifier, (s) => ({
        ...s,
        errorMessage: undefined,
        gmailReadPermission: connectionStatus.gmailReadPermission,
        redirectUrl: undefined,
        status: ComposioServerStatus.ACTIVE,
        tools,
      }));
      // The row is ACTIVE locally, but the server keeps serving the pre-refresh
      // row until `updateComposioPlugin` lands below. Hold this scope's list
      // responses until then: one the server answered in that window carries the
      // old row and would revert this write.
      this.#holdServerWrite(scope);
      this.#markLocalWrite(scope);

      clearLoading('refreshComposioConnectionStatus/success');

      try {
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
      } finally {
        this.#releaseServerWrite(scope);
      }
      // The server only now reflects the ACTIVE row: invalidate anything issued
      // while that write was in flight, so it cannot revert the status.
      this.#markLocalWrite(scope);
    } catch (error) {
      console.error('[Composio] Failed to refresh connection status:', error);

      if (cacheScope.get() === scope) {
        this.#servers.update(identifier, (s) => ({
          ...s,
          errorMessage: error instanceof Error ? error.message : String(error),
          status: ComposioServerStatus.ERROR,
        }));
        this.#markLocalWrite(scope);
      }

      clearLoading('refreshComposioConnectionStatus/error');
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
    // failure never resurrects the row the user just deleted. Recording the
    // removal also cancels a pending add of the same identifier: the row was
    // created but never echoed, so leaving it in `added` would re-append it the
    // moment a response clears `removed`, resurrecting the deleted row for the
    // rest of the session.
    this.#localIntent().added.delete(identifier);
    this.#localIntent().removed.add(identifier);
    this.#servers.remove(identifier);
    this.#markLocalWrite();

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
   * Local intent of the active identity. Kept per scope: the intent is about
   * this user's unsynced writes, so a workspace / user switch starts clean
   * rather than carrying the previous identity's pending rows over.
   */
  #localIntent = (): ComposioLocalIntent => {
    const scope = cacheScope.get();
    if (scope !== this.#intentScope) {
      this.#intentScope = scope;
      this.#intent = createComposioLocalIntent();
    }
    return this.#intent;
  };

  /** Write sequence of `scope` (defaults to the active identity). */
  #writeSeq = (scope = cacheScope.get()): number => this.#writeSeqByScope.get(scope) ?? 0;

  /**
   * Record a confirmed local write to the connections list. Monotonic per scope:
   * every `getComposioPlugins` response issued before that scope's latest write
   * is dropped, so a stale sync can neither drop a new connection, resurrect a
   * deleted one, nor revert a refreshed status (see `mergeComposioServers`).
   */
  #markLocalWrite = (scope = cacheScope.get()): void => {
    this.#writeSeqByScope.set(scope, this.#writeSeq(scope) + 1);
  };

  /** Hold this scope's list responses while a local write is being persisted. */
  #holdServerWrite = (scope: string): void => {
    this.#unpersistedWritesByScope.set(scope, (this.#unpersistedWritesByScope.get(scope) ?? 0) + 1);
  };

  /**
   * Release a hold. Keyed by the *initiating* scope, not the active one: the
   * identity may have switched while the write was in flight, and the other
   * scope's holds are not this write's to release.
   */
  #releaseServerWrite = (scope: string): void => {
    const pending = (this.#unpersistedWritesByScope.get(scope) ?? 0) - 1;
    if (pending > 0) this.#unpersistedWritesByScope.set(scope, pending);
    else this.#unpersistedWritesByScope.delete(scope);
  };

  #hasUnpersistedWrite = (scope = cacheScope.get()): boolean =>
    (this.#unpersistedWritesByScope.get(scope) ?? 0) > 0;

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

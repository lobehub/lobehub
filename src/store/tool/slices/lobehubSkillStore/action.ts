import { getLobehubSkillProviderById } from '@lobechat/const';
import { produce } from 'immer';

import {
  cacheScope,
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { toolsClient } from '@/libs/trpc/client';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type LobehubSkillStoreState } from './initialState';
import {
  createLobehubSkillLocalIntent,
  LOBEHUB_SKILL_SERVERS_KEY,
  type LobehubSkillLocalIntent,
  lobehubSkillProviderToolsResource,
  lobehubSkillServersEntity,
  lobehubSkillServersResource,
  mapProviderTools,
  mergeLobehubSkillServers,
} from './projection';
import {
  type CallLobehubSkillToolParams,
  type CallLobehubSkillToolResult,
  type LobehubSkillServer,
  type LobehubSkillTool,
} from './types';
import { LobehubSkillStatus } from './types';

const n = setNamespace('lobehubSkillStore');

/**
 * LobeHub Skill Store Actions
 */

/** The connections list is one entry, so every sync shares these params. */
const SERVERS_PARAMS = {} as Record<string, never>;

/**
 * The connections list keeps its long-standing flat `lobehubSkillServers` field
 * as the replica view, so every selector reads what it did. `undefined` means
 * "not loaded yet": the engine only hydrates an empty slot, so an empty-array
 * default would read as a real value and block the persisted row.
 */
const serversLens: ReplicaLens<ToolStore, LobehubSkillServer[]> = {
  clear: () => ({ lobehubSkillServers: undefined }),
  get: (state) => state.lobehubSkillServers,
  keys: (state) => (state.lobehubSkillServers ? [LOBEHUB_SKILL_SERVERS_KEY] : []),
  set: (_state, _key, data) => ({ lobehubSkillServers: data }),
};

/** The connections sync, plus the `mutate` alias the skills surfaces call. */
export interface LobehubSkillConnectionsSyncResult extends ReplicaSyncResult {
  /**
   * Nothing has been painted yet (no persisted row, no response) and a sync is
   * in flight. This is the `isLoading` the callers gated on before the replica
   * — it must stay on the public surface: a caller that reads "un-loaded" as
   * "empty" would flash a false state on a cold start (see `ToolAuthAlert`).
   */
  isLoading: boolean;
  /** Alias of `revalidate`, kept for the existing "reload skills" control. */
  mutate: () => Promise<unknown>;
}

type Setter = StoreSetter<ToolStore>;
export const createLobehubSkillStoreSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new LobehubSkillStoreActionImpl(set, get, _api);

export class LobehubSkillStoreActionImpl {
  readonly #get: () => ToolStore;
  #intent = createLobehubSkillLocalIntent();
  #intentScope?: string;
  /**
   * One provider's tool catalog, keyed by provider id — the replica view the
   * skill detail surfaces render from.
   */
  readonly #providerTools;
  /**
   * The user's connected providers — a `@lobechat/replica` list, so the
   * persisted row paints before the network answers and a connect / revoke shows
   * on the row at once.
   */
  readonly #servers;
  /** Entity handle so per-provider changes reach every place holding the row. */
  readonly #server;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
    this.#servers = createReplicaSlice(lobehubSkillServersResource, {
      actionPrefix: 'lobehubSkillServers',
      entity: lobehubSkillServersEntity,
      fetcher: () => this.#fetchServers(),
      get,
      // A list response replaces the whole value; merge local intent the
      // response predates so an in-flight sync cannot drop a just-connected
      // provider or resurrect a just-revoked one. The confirmed value is passed
      // in too, so a response without a tool catalog keeps the tools the row
      // already holds (see `mergeLobehubSkillServers`).
      merge: (incoming, confirmed) =>
        mergeLobehubSkillServers(incoming, this.#localIntent(), confirmed),
      set,
      stateKey: 'lobehubSkillServersReplica',
      view: serversLens,
    });
    this.#server = linkReplicaEntity<LobehubSkillServer>([this.#servers]);
    this.#providerTools = createReplicaSlice(lobehubSkillProviderToolsResource, {
      actionPrefix: 'lobehubSkillProviderTools',
      fetcher: async (provider) => {
        const response = await toolsClient.market.connectListTools.query({ provider });
        return mapProviderTools(response.tools);
      },
      get,
      set,
      stateKey: 'lobehubSkillToolsReplica',
      view: recordLens<ToolStore, LobehubSkillTool[]>('lobehubSkillToolsMap'),
    });
  }

  callLobehubSkillTool = async (
    params: CallLobehubSkillToolParams,
  ): Promise<CallLobehubSkillToolResult> => {
    const { provider, toolName, args, topicId } = params;
    const toolId = `${provider}:${toolName}`;

    this.#set(
      produce((draft: LobehubSkillStoreState) => {
        draft.lobehubSkillExecutingToolIds.add(toolId);
      }),
      false,
      n('callLobehubSkillTool/start'),
    );

    try {
      const response = await toolsClient.market.connectCallTool.mutate({
        args,
        provider,
        toolName,
        topicId,
      });

      this.#set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillExecutingToolIds.delete(toolId);
        }),
        false,
        n('callLobehubSkillTool/success'),
      );

      if (response.success === false) {
        const responseError = (response as any).error;
        let dataMessage: string | undefined;

        if (typeof response.data === 'string') {
          dataMessage = response.data;
        } else if (response.data !== undefined && response.data !== null) {
          dataMessage = JSON.stringify(response.data);
        }

        return {
          data: response.data,
          error: responseError?.message || dataMessage || 'LobeHub Skill call failed',
          errorCode: responseError?.code,
          success: false,
        };
      }

      return { data: response.data, success: true };
    } catch (error) {
      console.error('[LobehubSkill] Failed to call tool:', error);

      this.#set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillExecutingToolIds.delete(toolId);
        }),
        false,
        n('callLobehubSkillTool/error'),
      );

      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('NOT_CONNECTED') || errorMessage.includes('TOKEN_EXPIRED')) {
        return {
          error: errorMessage,
          errorCode: 'NOT_CONNECTED',
          success: false,
        };
      }

      return {
        error: errorMessage,
        success: false,
      };
    }
  };

  checkLobehubSkillStatus = async (provider: string): Promise<LobehubSkillServer | undefined> => {
    this.#set(
      produce((draft: LobehubSkillStoreState) => {
        draft.lobehubSkillLoadingIds.add(provider);
      }),
      false,
      n('checkLobehubSkillStatus/start'),
    );

    try {
      const response = await toolsClient.market.connectGetStatus.query({ provider });
      // Get provider config from local definition for correct display name
      const providerConfig = getLobehubSkillProviderById(provider);

      const server: LobehubSkillServer = {
        cachedAt: Date.now(),
        icon: response.icon,
        identifier: provider,
        isConnected: response.connected,
        // Use local config label (e.g., "Linear") instead of API's providerName
        name: providerConfig?.label || provider,
        providerUsername: response.connection?.providerUsername,
        scopes: response.connection?.scopes,
        status: response.connected
          ? LobehubSkillStatus.CONNECTED
          : LobehubSkillStatus.NOT_CONNECTED,
        tokenExpiresAt: response.connection?.tokenExpiresAt,
      };

      this.#upsertServer(server);

      this.#set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillLoadingIds.delete(provider);
        }),
        false,
        n('checkLobehubSkillStatus/success'),
      );

      if (server.isConnected) {
        this.#get().refreshLobehubSkillTools(provider);
      }

      return server;
    } catch (error) {
      console.error('[LobehubSkill] Failed to check status:', error);

      this.#set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillLoadingIds.delete(provider);
        }),
        false,
        n('checkLobehubSkillStatus/error'),
      );

      return undefined;
    }
  };

  getLobehubSkillAuthorizeUrl = async (
    provider: string,
    options?: { redirectUri?: string; scopes?: string[] },
  ): Promise<{ authorizeUrl: string; code: string; expiresIn: number }> => {
    const response = await toolsClient.market.connectGetAuthorizeUrl.query({
      provider,
      redirectUri: options?.redirectUri,
      scopes: options?.scopes,
    });

    return {
      authorizeUrl: response.authorizeUrl,
      code: response.code,
      expiresIn: response.expiresIn,
    };
  };

  internal_updateLobehubSkillServer = (
    provider: string,
    update: Partial<LobehubSkillServer>,
  ): void => {
    this.#server.update(provider, (server) => ({ ...server, ...update }));
  };

  refreshLobehubSkillToken = async (provider: string): Promise<boolean> => {
    try {
      const response = await toolsClient.market.connectRefresh.mutate({ provider });

      if (response.refreshed) {
        this.#get().internal_updateLobehubSkillServer(provider, {
          status: LobehubSkillStatus.CONNECTED,
          tokenExpiresAt: response.connection?.tokenExpiresAt,
        });
      }

      return response.refreshed;
    } catch (error) {
      console.error('[LobehubSkill] Failed to refresh token:', error);
      return false;
    }
  };

  refreshLobehubSkillTools = async (provider: string): Promise<void> => {
    try {
      const response = await toolsClient.market.connectListTools.query({ provider });

      this.#server.update(provider, (server) => ({
        ...server,
        tools: response.tools as LobehubSkillTool[],
      }));
    } catch (error) {
      console.error('[LobehubSkill] Failed to refresh tools:', error);
    }
  };

  revokeLobehubSkill = async (provider: string): Promise<void> => {
    this.#set(
      produce((draft: LobehubSkillStoreState) => {
        draft.lobehubSkillLoadingIds.add(provider);
      }),
      false,
      n('revokeLobehubSkill/start'),
    );

    try {
      await toolsClient.market.connectRevoke.mutate({ provider });

      // Drop the row locally, and keep a list response that was already in
      // flight from bringing the revoked provider back.
      const intent = this.#localIntent();
      intent.added.delete(provider);
      intent.removed.add(provider);
      this.#server.remove(provider);

      this.#set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillLoadingIds.delete(provider);
        }),
        false,
        n('revokeLobehubSkill/success'),
      );
    } catch (error) {
      console.error('[LobehubSkill] Failed to revoke:', error);

      this.#set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillLoadingIds.delete(provider);
        }),
        false,
        n('revokeLobehubSkill/error'),
      );
    }
  };

  /**
   * Fetch orchestration only; read the tools through `lobehubSkillToolsMap`.
   * One replica entry per provider, so switching providers paints the cached
   * tools and the network only confirms.
   */
  useFetchProviderTools = (provider: string | undefined): ReplicaSyncResult =>
    this.#providerTools.useSync(provider ?? null, { revalidateOnFocus: false });

  /**
   * Fetch orchestration only; read the list through `lobehubSkillSelectors`.
   * The persisted row paints the first frame, and a connect / revoke is folded
   * into the same replica entry the surfaces already read.
   */
  useFetchLobehubSkillConnections = (enabled: boolean): LobehubSkillConnectionsSyncResult => {
    const isSignedIn = useUserStore(authSelectors.isLogin);

    const sync = this.#servers.useSync(SERVERS_PARAMS, {
      enabled: enabled && isSignedIn,
      onSuccess: (servers) => {
        // The connections response carries no tools; fill each connected
        // provider's catalog so the agent tool list can resolve them.
        for (const server of servers) {
          this.#get().refreshLobehubSkillTools(server.identifier);
        }
      },
      revalidateOnFocus: false,
    });

    // `isLoading` in the pre-replica sense: the list has not been painted yet
    // (neither the persisted row nor a response) and a sync is in flight. It is
    // read through the view instead of `isHydrated`, because hydration resolves
    // just after mount even when there is nothing stored — gating on it would
    // re-open the cold-start false state this flag exists to prevent.
    const isLoading = this.#get().lobehubSkillServers === undefined && sync.isValidating;

    return { ...sync, isLoading, mutate: sync.revalidate };
  };

  /**
   * Local intent of the active identity. Kept per scope: the intent is about
   * this user's unsynced writes, so a workspace / user switch starts clean
   * rather than carrying the previous identity's pending rows over.
   */
  #localIntent = (): LobehubSkillLocalIntent => {
    const scope = cacheScope.get();
    if (scope !== this.#intentScope) {
      this.#intentScope = scope;
      this.#intent = createLobehubSkillLocalIntent();
    }
    return this.#intent;
  };

  /** Replace the row in place (by identifier) or append the new one. */
  #upsertServer = (server: LobehubSkillServer): void => {
    // The two intents are mutually exclusive per provider: a fresh write
    // supersedes a pending revoke, so a re-connect inside the race window is
    // never hidden by the previous revoke.
    const intent = this.#localIntent();
    intent.removed.delete(server.identifier);
    // The row survives a list response that was already in flight when it was
    // written (see `mergeLobehubSkillServers`).
    intent.added.set(server.identifier, server);
    this.#servers.update(LOBEHUB_SKILL_SERVERS_KEY, (servers) => {
      const list = servers ?? [];
      const index = list.findIndex((s) => s.identifier === server.identifier);
      if (index < 0) return [...list, server];
      return list.map((s, i) => (i === index ? { ...s, ...server } : s));
    });
  };

  /** The user's connected providers (`connectListConnections`). */
  #fetchServers = async (): Promise<LobehubSkillServer[]> => {
    const response = await toolsClient.market.connectListConnections.query();

    return response.connections.map((conn: any) => {
      // Get provider config from local definition for correct display name
      const providerConfig = getLobehubSkillProviderById(conn.providerId);
      return {
        cachedAt: Date.now(),
        icon: conn.icon,
        identifier: conn.providerId,
        isConnected: true,
        // Use local config label (e.g., "Linear") instead of API's providerName (which is user's name on that service)
        name: providerConfig?.label || conn.providerId,
        providerUsername: conn.providerUsername,
        scopes: conn.scopes,
        status: LobehubSkillStatus.CONNECTED,
        tokenExpiresAt: conn.tokenExpiresAt,
      };
    });
  };
}

export type LobehubSkillStoreAction = Pick<
  LobehubSkillStoreActionImpl,
  keyof LobehubSkillStoreActionImpl
>;

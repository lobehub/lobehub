import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { produce } from 'immer';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { toolKeys } from '@/libs/swr/keys';
import { lambdaClient, toolsClient } from '@/libs/trpc/client';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type ComposioStoreState } from './initialState';
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

type Setter = StoreSetter<ToolStore>;
export const createComposioStoreSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new ComposioStoreActionImpl(set, get, _api);

export class ComposioStoreActionImpl {
  readonly #get: () => ToolStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
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
    const { appSlug, identifier, label } = params;

    this.#set(
      produce((draft: ComposioStoreState) => {
        draft.loadingComposioServerIds.add(identifier);
      }),
      false,
      n('createComposioConnection/start'),
    );

    try {
      const response = await lambdaClient.composio.createConnection.mutate({
        appSlug,
        identifier,
        label,
      });

      const server: ComposioServer = {
        appSlug,
        authConfigId: response.authConfigId,
        connectedAccountId: response.connectedAccountId,
        createdAt: 0,
        identifier: response.identifier,
        label,
        redirectUrl: response.redirectUrl,
        status: ComposioServerStatus.PENDING_AUTH,
      };

      this.#set(
        produce((draft: ComposioStoreState) => {
          const existingIndex = draft.composioServers.findIndex((s) => s.identifier === identifier);
          if (existingIndex >= 0) {
            draft.composioServers[existingIndex] = server;
          } else {
            draft.composioServers.push(server);
          }
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

      this.#set(
        produce((draft: ComposioStoreState) => {
          const serverIndex = draft.composioServers.findIndex((s) => s.identifier === identifier);
          if (serverIndex >= 0) {
            draft.composioServers[serverIndex].tools = tools;
            draft.composioServers[serverIndex].status = ComposioServerStatus.ACTIVE;
            draft.composioServers[serverIndex].redirectUrl = undefined;
            draft.composioServers[serverIndex].errorMessage = undefined;
          }
          draft.loadingComposioServerIds.delete(identifier);
        }),
        false,
        n('refreshComposioConnectionStatus/success'),
      );

      await lambdaClient.composio.updateComposioPlugin.mutate({
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

      this.#set(
        produce((draft: ComposioStoreState) => {
          const serverIndex = draft.composioServers.findIndex((s) => s.identifier === identifier);
          if (serverIndex >= 0) {
            draft.composioServers[serverIndex].status = ComposioServerStatus.ERROR;
            draft.composioServers[serverIndex].errorMessage =
              error instanceof Error ? error.message : String(error);
          }
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

    this.#set(
      produce((draft: ComposioStoreState) => {
        draft.composioServers = draft.composioServers.filter((s) => s.identifier !== identifier);
      }),
      false,
      n('removeComposioConnection'),
    );

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

  useFetchAppTools = (appSlug: string | undefined): SWRResponse<ComposioTool[]> => {
    return useSWR<ComposioTool[]>(
      appSlug ? toolKeys.composioAppTools(appSlug) : null,
      async () => {
        const response = await toolsClient.composio.getActions.query({ appSlug: appSlug! });
        return (response.tools || []) as ComposioTool[];
      },
      { fallbackData: [], revalidateOnFocus: false },
    );
  };

  useFetchUserComposioConnections = (enabled: boolean): SWRResponse<ComposioServer[]> => {
    return useSWR<ComposioServer[]>(
      enabled ? toolKeys.composioConnections() : null,
      async () => {
        const composioPlugins = await lambdaClient.composio.getComposioPlugins.query();

        if (composioPlugins.length === 0) return [];

        const validPlugins = composioPlugins.filter((plugin) => plugin.customParams?.composio);

        // Only surface connections this client knows how to render. Identifiers
        // outside the static catalog are hidden locally — never deleted: an
        // outdated bundle (missing a newly-added app) would otherwise silently
        // destroy a legitimate remote connection. Deprecating an app is a
        // server-side concern, not a side effect of a client fetch.
        return validPlugins
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
      },
      {
        fallbackData: [],
        onSuccess: (data) => {
          this.#set(
            produce((draft: ComposioStoreState) => {
              if (data.length > 0) {
                const existingIdentifiers = new Set(draft.composioServers.map((s) => s.identifier));
                const newServers = data.filter((s) => !existingIdentifiers.has(s.identifier));
                draft.composioServers = [...draft.composioServers, ...newServers];
              }
              draft.isComposioServersInit = true;
            }),
            false,
            n('useFetchUserComposioConnections'),
          );
        },
        revalidateOnFocus: false,
      },
    );
  };
}

export type ComposioStoreAction = Pick<ComposioStoreActionImpl, keyof ComposioStoreActionImpl>;

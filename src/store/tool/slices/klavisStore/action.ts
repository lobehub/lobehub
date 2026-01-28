import { enableMapSet, produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { lambdaClient, toolsClient } from '@/libs/trpc/client';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type KlavisStoreState } from './initialState';
import {
  type CallKlavisToolParams,
  type CallKlavisToolResult,
  type CreateKlavisServerParams,
  type KlavisServer,
  KlavisServerStatus,
  type KlavisTool,
} from './types';

enableMapSet();

const n = setNamespace('klavisStore');

/**
 * Klavis Store Actions
 */
export interface KlavisStoreAction {
  /**
   * Call Klavis tool
   */
  callKlavisTool: (params: CallKlavisToolParams) => Promise<CallKlavisToolResult>;

  /**
   * Complete OAuth authentication and update server status
   * @param identifier - Server identifier (e.g., 'google-calendar')
   */
  completeKlavisServerAuth: (identifier: string) => Promise<void>;

  /**
   * Create a single Klavis MCP Server instance
   * @returns Created server instance, or object with oauthUrl if OAuth is required
   */
  createKlavisServer: (params: CreateKlavisServerParams) => Promise<KlavisServer | undefined>;

  /**
   * Refresh Klavis Server tool list
   * @param identifier - Server identifier (e.g., 'google-calendar')
   */
  refreshKlavisServerTools: (identifier: string) => Promise<void>;

  /**
   * Remove Klavis Server
   * @param identifier - Server identifier (e.g., 'google-calendar')
   */
  removeKlavisServer: (identifier: string) => Promise<void>;

  /**
   * Use SWR to fetch user's Klavis server list
   * @param enabled - Whether to enable fetching
   */
  useFetchUserKlavisServers: (enabled: boolean) => SWRResponse<KlavisServer[]>;
}

export const createKlavisStoreSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  KlavisStoreAction
> = (set, get) => ({
  callKlavisTool: async (params) => {
    const { serverUrl, toolName, toolArgs } = params;

    const toolId = `${serverUrl}:${toolName}`;

    set(
      produce((draft: KlavisStoreState) => {
        draft.executingToolIds.add(toolId);
      }),
      false,
      n('callKlavisTool/start'),
    );

    try {
      // Call tRPC server interface to execute tool (use toolsClient for longer timeout)
      const response = await toolsClient.klavis.callTool.mutate({
        serverUrl,
        toolArgs,
        toolName,
      });

      console.log('toolsClient.klavis.callTool-response', response);

      set(
        produce((draft: KlavisStoreState) => {
          draft.executingToolIds.delete(toolId);
        }),
        false,
        n('callKlavisTool/success'),
      );

      return { data: response, success: true };
    } catch (error) {
      console.error('[Klavis] Failed to call tool:', error);

      set(
        produce((draft: KlavisStoreState) => {
          draft.executingToolIds.delete(toolId);
        }),
        false,
        n('callKlavisTool/error'),
      );

      return {
        error: error instanceof Error ? error.message : String(error),
        success: false,
      };
    }
  },

  completeKlavisServerAuth: async (identifier) => {
    // After OAuth completes, refresh tool list
    await get().refreshKlavisServerTools(identifier);
  },

  createKlavisServer: async (params) => {
    const { userId, serverName, identifier } = params;

    set(
      produce((draft: KlavisStoreState) => {
        draft.loadingServerIds.add(identifier);
      }),
      false,
      n('createKlavisServer/start'),
    );

    try {
      // Call tRPC server interface to create single server instance
      const response = await lambdaClient.klavis.createServerInstance.mutate({
        identifier,
        serverName,
        userId,
      });

      // Build server object
      const server: KlavisServer = {
        createdAt: Date.now(),
        identifier: response.identifier,
        instanceId: response.instanceId,
        isAuthenticated: response.isAuthenticated,
        oauthUrl: response.oauthUrl,
        serverName: response.serverName,
        serverUrl: response.serverUrl,
        status: response.isAuthenticated
          ? KlavisServerStatus.CONNECTED
          : KlavisServerStatus.PENDING_AUTH,
      };

      // Add to servers list
      set(
        produce((draft: KlavisStoreState) => {
          // Check if already exists (using identifier), update if exists
          const existingIndex = draft.servers.findIndex((s) => s.identifier === identifier);
          if (existingIndex >= 0) {
            draft.servers[existingIndex] = server;
          } else {
            draft.servers.push(server);
          }
          draft.loadingServerIds.delete(identifier);
        }),
        false,
        n('createKlavisServer/success'),
      );

      return server;
    } catch (error) {
      console.error('[Klavis] Failed to create server:', error);

      set(
        produce((draft: KlavisStoreState) => {
          draft.loadingServerIds.delete(identifier);
        }),
        false,
        n('createKlavisServer/error'),
      );

      return undefined;
    }
  },

  refreshKlavisServerTools: async (identifier) => {
    const { servers } = get();

    // Find server using identifier
    const server = servers.find((s) => s.identifier === identifier);
    if (!server) {
      console.error('[Klavis] Server not found:', identifier);
      return;
    }

    set(
      produce((draft: KlavisStoreState) => {
        draft.loadingServerIds.add(identifier);
      }),
      false,
      n('refreshKlavisServerTools/start'),
    );

    try {
      // First check server authentication status
      const instanceStatus = await lambdaClient.klavis.getServerInstance.query({
        instanceId: server.instanceId,
      });

      // If server returned an auth error (during polling), silently return
      // This happens when user is still in the process of authorizing
      if (instanceStatus.error === 'AUTH_ERROR') {
        set(
          produce((draft: KlavisStoreState) => {
            draft.loadingServerIds.delete(identifier);
          }),
          false,
          n('refreshKlavisServerTools/pendingAuth'),
        );
        return;
      }

      // If authentication failed, remove server and reset status
      if (!instanceStatus.isAuthenticated) {
        if (!instanceStatus.authNeeded) {
          // If no authentication needed, all is well
          set(
            produce((draft: KlavisStoreState) => {
              draft.loadingServerIds.delete(identifier);
            }),
            false,
            n('refreshKlavisServerTools/noAuthNeeded'),
          );
          return;
        }

        // Remove from local state (using identifier)
        set(
          produce((draft: KlavisStoreState) => {
            draft.servers = draft.servers.filter((s) => s.identifier !== identifier);
            draft.loadingServerIds.delete(identifier);
          }),
          false,
          n('refreshKlavisServerTools/authFailed'),
        );

        // Delete from database
        await lambdaClient.klavis.deleteServerInstance.mutate({
          identifier,
          instanceId: server.instanceId,
        });

        return;
      }

      // Authentication successful, get tool list (use toolsClient for longer timeout)
      const response = await toolsClient.klavis.listTools.query({
        serverUrl: server.serverUrl,
      });

      const tools = response.tools as KlavisTool[];

      set(
        produce((draft: KlavisStoreState) => {
          // Find server using identifier
          const serverIndex = draft.servers.findIndex((s) => s.identifier === identifier);
          if (serverIndex >= 0) {
            draft.servers[serverIndex].tools = tools;
            draft.servers[serverIndex].status = KlavisServerStatus.CONNECTED;
            draft.servers[serverIndex].isAuthenticated = true;
            draft.servers[serverIndex].errorMessage = undefined;
          }
          draft.loadingServerIds.delete(identifier);
        }),
        false,
        n('refreshKlavisServerTools/success'),
      );

      // Update tool list and authentication status in database
      await lambdaClient.klavis.updateKlavisPlugin.mutate({
        identifier,
        instanceId: server.instanceId,
        isAuthenticated: true,
        serverName: server.serverName,
        serverUrl: server.serverUrl,
        tools: tools.map((t) => ({
          description: t.description,
          inputSchema: t.inputSchema,
          name: t.name,
        })),
      });
    } catch (error) {
      console.error('[Klavis] Failed to refresh tools:', error);

      set(
        produce((draft: KlavisStoreState) => {
          // Find server using identifier
          const serverIndex = draft.servers.findIndex((s) => s.identifier === identifier);
          if (serverIndex >= 0) {
            draft.servers[serverIndex].status = KlavisServerStatus.ERROR;
            draft.servers[serverIndex].errorMessage =
              error instanceof Error ? error.message : String(error);
          }
          draft.loadingServerIds.delete(identifier);
        }),
        false,
        n('refreshKlavisServerTools/error'),
      );
    }
  },

  removeKlavisServer: async (identifier) => {
    const { servers } = get();
    // Find server using identifier
    const server = servers.find((s) => s.identifier === identifier);

    set(
      produce((draft: KlavisStoreState) => {
        // Filter using identifier
        draft.servers = draft.servers.filter((s) => s.identifier !== identifier);
      }),
      false,
      n('removeKlavisServer'),
    );

    // Delete from Klavis API and database
    if (server) {
      try {
        await lambdaClient.klavis.deleteServerInstance.mutate({
          identifier,
          instanceId: server.instanceId,
        });
      } catch (error) {
        console.error('[Klavis] Failed to delete server instance:', error);
      }
    }
  },

  useFetchUserKlavisServers: (enabled) =>
    useSWR<KlavisServer[]>(
      enabled ? 'fetchUserKlavisServers' : null,
      async () => {
        const klavisPlugins = await lambdaClient.klavis.getKlavisPlugins.query();

        if (klavisPlugins.length === 0) return [];

        // Convert to KlavisServer objects
        return klavisPlugins
          .filter((plugin) => plugin.customParams?.klavis)
          .map((plugin) => {
            const klavisParams = plugin.customParams!.klavis!;
            const tools: KlavisTool[] = (plugin.manifest?.api || []).map((api) => ({
              description: api.description,
              inputSchema: api.parameters as KlavisTool['inputSchema'],
              name: api.name,
            }));

            return {
              createdAt: Date.now(),
              identifier: plugin.identifier,
              instanceId: klavisParams.instanceId,
              isAuthenticated: klavisParams.isAuthenticated,
              oauthUrl: klavisParams.oauthUrl,
              serverName: klavisParams.serverName,
              serverUrl: klavisParams.serverUrl,
              status: klavisParams.isAuthenticated
                ? KlavisServerStatus.CONNECTED
                : KlavisServerStatus.PENDING_AUTH,
              tools,
            };
          });
      },
      {
        fallbackData: [],
        onSuccess: (data) => {
          set(
            produce((draft: KlavisStoreState) => {
              if (data.length > 0) {
                // Check if already exists using identifier
                const existingIdentifiers = new Set(draft.servers.map((s) => s.identifier));
                const newServers = data.filter((s) => !existingIdentifiers.has(s.identifier));
                draft.servers = [...draft.servers, ...newServers];
              }
              draft.isServersInit = true;
            }),
            false,
            n('useFetchUserKlavisServers'),
          );
        },
        revalidateOnFocus: false,
      },
    ),
});

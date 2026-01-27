import { getLobehubSkillProviderById } from '@lobechat/const';
import { enableMapSet, produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { toolsClient } from '@/libs/trpc/client';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type LobehubSkillStoreState } from './initialState';
import {
  type CallLobehubSkillToolParams,
  type CallLobehubSkillToolResult,
  type LobehubSkillServer,
  LobehubSkillStatus,
  type LobehubSkillTool,
} from './types';

enableMapSet();

const n = setNamespace('lobehubSkillStore');

/**
 * LobeHub Skill Store Actions
 */
export interface LobehubSkillStoreAction {
  /**
   * Call LobeHub Skill tool
   */
  callLobehubSkillTool: (params: CallLobehubSkillToolParams) => Promise<CallLobehubSkillToolResult>;

  /**
   * Get single Provider connection status
   * @param provider - Provider ID (e.g., 'linear')
   */
  checkLobehubSkillStatus: (provider: string) => Promise<LobehubSkillServer | undefined>;

  /**
   * Get Provider authorization info (URL, code, expiration time)
   * @param provider - Provider ID (e.g., 'linear')
   * @param options - Optional scopes and redirectUri
   * @returns Authorization URL and related info
   */
  getLobehubSkillAuthorizeUrl: (
    provider: string,
    options?: { redirectUri?: string; scopes?: string[] },
  ) => Promise<{ authorizeUrl: string; code: string; expiresIn: number }>;

  /**
   * Internal method: Update Server status
   */
  internal_updateLobehubSkillServer: (
    provider: string,
    update: Partial<LobehubSkillServer>,
  ) => void;

  /**
   * Refresh Provider Token (if supported)
   * @param provider - Provider ID
   */
  refreshLobehubSkillToken: (provider: string) => Promise<boolean>;

  /**
   * Refresh Provider tool list
   * @param provider - Provider ID
   */
  refreshLobehubSkillTools: (provider: string) => Promise<void>;

  /**
   * Disconnect Provider connection
   * @param provider - Provider ID
   */
  revokeLobehubSkill: (provider: string) => Promise<void>;

  /**
   * Use SWR to fetch user's all connection statuses
   * @param enabled - Whether to enable fetching
   */
  useFetchLobehubSkillConnections: (enabled: boolean) => SWRResponse<LobehubSkillServer[]>;
}

export const createLobehubSkillStoreSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  LobehubSkillStoreAction
> = (set, get) => ({
  callLobehubSkillTool: async (params) => {
    const { provider, toolName, args } = params;
    const toolId = `${provider}:${toolName}`;

    set(
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
      });

      set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillExecutingToolIds.delete(toolId);
        }),
        false,
        n('callLobehubSkillTool/success'),
      );

      return { data: response.data, success: true };
    } catch (error) {
      console.error('[LobehubSkill] Failed to call tool:', error);

      set(
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
  },

  checkLobehubSkillStatus: async (provider) => {
    set(
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

      set(
        produce((draft: LobehubSkillStoreState) => {
          const existingIndex = draft.lobehubSkillServers.findIndex(
            (s) => s.identifier === provider,
          );
          if (existingIndex >= 0) {
            draft.lobehubSkillServers[existingIndex] = server;
          } else {
            draft.lobehubSkillServers.push(server);
          }
          draft.lobehubSkillLoadingIds.delete(provider);
        }),
        false,
        n('checkLobehubSkillStatus/success'),
      );

      if (server.isConnected) {
        get().refreshLobehubSkillTools(provider);
      }

      return server;
    } catch (error) {
      console.error('[LobehubSkill] Failed to check status:', error);

      set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillLoadingIds.delete(provider);
        }),
        false,
        n('checkLobehubSkillStatus/error'),
      );

      return undefined;
    }
  },

  getLobehubSkillAuthorizeUrl: async (provider, options) => {
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
  },

  internal_updateLobehubSkillServer: (provider, update) => {
    set(
      produce((draft: LobehubSkillStoreState) => {
        const serverIndex = draft.lobehubSkillServers.findIndex((s) => s.identifier === provider);
        if (serverIndex >= 0) {
          draft.lobehubSkillServers[serverIndex] = {
            ...draft.lobehubSkillServers[serverIndex],
            ...update,
          };
        }
      }),
      false,
      n('internal_updateLobehubSkillServer'),
    );
  },

  refreshLobehubSkillToken: async (provider) => {
    try {
      const response = await toolsClient.market.connectRefresh.mutate({ provider });

      if (response.refreshed) {
        get().internal_updateLobehubSkillServer(provider, {
          status: LobehubSkillStatus.CONNECTED,
          tokenExpiresAt: response.connection?.tokenExpiresAt,
        });
      }

      return response.refreshed;
    } catch (error) {
      console.error('[LobehubSkill] Failed to refresh token:', error);
      return false;
    }
  },

  refreshLobehubSkillTools: async (provider) => {
    try {
      const response = await toolsClient.market.connectListTools.query({ provider });

      set(
        produce((draft: LobehubSkillStoreState) => {
          const serverIndex = draft.lobehubSkillServers.findIndex((s) => s.identifier === provider);
          if (serverIndex >= 0) {
            draft.lobehubSkillServers[serverIndex].tools = response.tools as LobehubSkillTool[];
          }
        }),
        false,
        n('refreshLobehubSkillTools/success'),
      );
    } catch (error) {
      console.error('[LobehubSkill] Failed to refresh tools:', error);
    }
  },

  revokeLobehubSkill: async (provider) => {
    set(
      produce((draft: LobehubSkillStoreState) => {
        draft.lobehubSkillLoadingIds.add(provider);
      }),
      false,
      n('revokeLobehubSkill/start'),
    );

    try {
      await toolsClient.market.connectRevoke.mutate({ provider });

      set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillServers = draft.lobehubSkillServers.filter(
            (s) => s.identifier !== provider,
          );
          draft.lobehubSkillLoadingIds.delete(provider);
        }),
        false,
        n('revokeLobehubSkill/success'),
      );
    } catch (error) {
      console.error('[LobehubSkill] Failed to revoke:', error);

      set(
        produce((draft: LobehubSkillStoreState) => {
          draft.lobehubSkillLoadingIds.delete(provider);
        }),
        false,
        n('revokeLobehubSkill/error'),
      );
    }
  },

  useFetchLobehubSkillConnections: (enabled) =>
    useSWR<LobehubSkillServer[]>(
      enabled ? 'fetchLobehubSkillConnections' : null,
      async () => {
        const response = await toolsClient.market.connectListConnections.query();

        // Debug logging

        return response.connections.map((conn: any) => {
          // Debug logging for each connection

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
      },
      {
        fallbackData: [],
        onSuccess: (data) => {
          if (data.length > 0) {
            set(
              produce((draft: LobehubSkillStoreState) => {
                const existingIds = new Set(draft.lobehubSkillServers.map((s) => s.identifier));
                const newServers = data.filter((s) => !existingIds.has(s.identifier));
                draft.lobehubSkillServers = [...draft.lobehubSkillServers, ...newServers];
              }),
              false,
              n('useFetchLobehubSkillConnections'),
            );

            for (const server of data) {
              get().refreshLobehubSkillTools(server.identifier);
            }
          }
        },
        revalidateOnFocus: false,
      },
    ),
});

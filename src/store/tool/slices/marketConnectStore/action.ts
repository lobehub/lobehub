import { enableMapSet, produce } from 'immer';
import useSWR, { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { toolsClient } from '@/libs/trpc/client';
import { setNamespace } from '@/utils/storeDebug';

import { type ToolStore } from '../../store';
import { type MarketConnectStoreState } from './initialState';
import {
  type CallMarketConnectToolParams,
  type CallMarketConnectToolResult,
  type MarketConnectServer,
  MarketConnectStatus,
  type MarketConnectTool,
} from './types';

enableMapSet();

const n = setNamespace('marketConnectStore');

/**
 * Market Connect Store Actions
 */
export interface MarketConnectStoreAction {
  /**
   * 调用 Market Connect 工具
   */
  callMarketConnectTool: (
    params: CallMarketConnectToolParams,
  ) => Promise<CallMarketConnectToolResult>;

  /**
   * 获取单个 Provider 的连接状态
   * @param provider - Provider ID (如 'linear')
   */
  checkMarketConnectStatus: (provider: string) => Promise<MarketConnectServer | undefined>;

  /**
   * 获取 Provider 的授权信息（URL、code、过期时间）
   * @param provider - Provider ID (如 'linear')
   * @param options - 可选的 scopes 和 redirectUri
   * @returns 授权 URL 和相关信息
   */
  getMarketConnectAuthorizeUrl: (
    provider: string,
    options?: { redirectUri?: string; scopes?: string[] },
  ) => Promise<{ authorizeUrl: string; code: string; expiresIn: number }>;

  /**
   * 内部方法: 更新 Server 状态
   */
  internal_updateMarketConnectServer: (
    provider: string,
    update: Partial<MarketConnectServer>,
  ) => void;

  /**
   * 刷新 Provider 的 Token (如果支持)
   * @param provider - Provider ID
   */
  refreshMarketConnectToken: (provider: string) => Promise<boolean>;

  /**
   * 刷新 Provider 的工具列表
   * @param provider - Provider ID
   */
  refreshMarketConnectTools: (provider: string) => Promise<void>;

  /**
   * 断开 Provider 连接
   * @param provider - Provider ID
   */
  revokeMarketConnect: (provider: string) => Promise<void>;

  /**
   * 使用 SWR 获取用户的所有连接状态
   * @param enabled - 是否启用获取
   */
  useFetchMarketConnectConnections: (enabled: boolean) => SWRResponse<MarketConnectServer[]>;
}

export const createMarketConnectStoreSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  MarketConnectStoreAction
> = (set, get) => ({
  callMarketConnectTool: async (params) => {
    const { provider, toolName, args } = params;
    const toolId = `${provider}:${toolName}`;

    set(
      produce((draft: MarketConnectStoreState) => {
        draft.marketConnectExecutingToolIds.add(toolId);
      }),
      false,
      n('callMarketConnectTool/start'),
    );

    try {
      const response = await toolsClient.market.connectCallTool.mutate({
        args,
        provider,
        toolName,
      });

      set(
        produce((draft: MarketConnectStoreState) => {
          draft.marketConnectExecutingToolIds.delete(toolId);
        }),
        false,
        n('callMarketConnectTool/success'),
      );

      return { data: response.data, success: true };
    } catch (error) {
      console.error('[MarketConnect] Failed to call tool:', error);

      set(
        produce((draft: MarketConnectStoreState) => {
          draft.marketConnectExecutingToolIds.delete(toolId);
        }),
        false,
        n('callMarketConnectTool/error'),
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

  checkMarketConnectStatus: async (provider) => {
    set(
      produce((draft: MarketConnectStoreState) => {
        draft.marketConnectLoadingIds.add(provider);
      }),
      false,
      n('checkMarketConnectStatus/start'),
    );

    try {
      const response = await toolsClient.market.connectGetStatus.query({ provider });

      const server: MarketConnectServer = {
        cachedAt: Date.now(),
        icon: response.icon,
        identifier: provider,
        isConnected: response.connected,
        name: response.providerName || provider,
        providerUsername: response.connection?.providerUsername,
        scopes: response.connection?.scopes,
        status: response.connected
          ? MarketConnectStatus.CONNECTED
          : MarketConnectStatus.NOT_CONNECTED,
        tokenExpiresAt: response.connection?.tokenExpiresAt,
      };

      set(
        produce((draft: MarketConnectStoreState) => {
          const existingIndex = draft.marketConnectServers.findIndex(
            (s) => s.identifier === provider,
          );
          if (existingIndex >= 0) {
            draft.marketConnectServers[existingIndex] = server;
          } else {
            draft.marketConnectServers.push(server);
          }
          draft.marketConnectLoadingIds.delete(provider);
        }),
        false,
        n('checkMarketConnectStatus/success'),
      );

      if (server.isConnected) {
        get().refreshMarketConnectTools(provider);
      }

      return server;
    } catch (error) {
      console.error('[MarketConnect] Failed to check status:', error);

      set(
        produce((draft: MarketConnectStoreState) => {
          draft.marketConnectLoadingIds.delete(provider);
        }),
        false,
        n('checkMarketConnectStatus/error'),
      );

      return undefined;
    }
  },

  getMarketConnectAuthorizeUrl: async (provider, options) => {
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

  internal_updateMarketConnectServer: (provider, update) => {
    set(
      produce((draft: MarketConnectStoreState) => {
        const serverIndex = draft.marketConnectServers.findIndex((s) => s.identifier === provider);
        if (serverIndex >= 0) {
          draft.marketConnectServers[serverIndex] = {
            ...draft.marketConnectServers[serverIndex],
            ...update,
          };
        }
      }),
      false,
      n('internal_updateMarketConnectServer'),
    );
  },

  refreshMarketConnectToken: async (provider) => {
    try {
      const response = await toolsClient.market.connectRefresh.mutate({ provider });

      if (response.refreshed) {
        get().internal_updateMarketConnectServer(provider, {
          status: MarketConnectStatus.CONNECTED,
          tokenExpiresAt: response.connection?.tokenExpiresAt,
        });
      }

      return response.refreshed;
    } catch (error) {
      console.error('[MarketConnect] Failed to refresh token:', error);
      return false;
    }
  },

  refreshMarketConnectTools: async (provider) => {
    try {
      const response = await toolsClient.market.connectListTools.query({ provider });

      set(
        produce((draft: MarketConnectStoreState) => {
          const serverIndex = draft.marketConnectServers.findIndex(
            (s) => s.identifier === provider,
          );
          if (serverIndex >= 0) {
            draft.marketConnectServers[serverIndex].tools = response.tools as MarketConnectTool[];
          }
        }),
        false,
        n('refreshMarketConnectTools/success'),
      );
    } catch (error) {
      console.error('[MarketConnect] Failed to refresh tools:', error);
    }
  },

  revokeMarketConnect: async (provider) => {
    set(
      produce((draft: MarketConnectStoreState) => {
        draft.marketConnectLoadingIds.add(provider);
      }),
      false,
      n('revokeMarketConnect/start'),
    );

    try {
      await toolsClient.market.connectRevoke.mutate({ provider });

      set(
        produce((draft: MarketConnectStoreState) => {
          draft.marketConnectServers = draft.marketConnectServers.filter(
            (s) => s.identifier !== provider,
          );
          draft.marketConnectLoadingIds.delete(provider);
        }),
        false,
        n('revokeMarketConnect/success'),
      );
    } catch (error) {
      console.error('[MarketConnect] Failed to revoke:', error);

      set(
        produce((draft: MarketConnectStoreState) => {
          draft.marketConnectLoadingIds.delete(provider);
        }),
        false,
        n('revokeMarketConnect/error'),
      );
    }
  },

  useFetchMarketConnectConnections: (enabled) =>
    useSWR<MarketConnectServer[]>(
      enabled ? 'fetchMarketConnectConnections' : null,
      async () => {
        const response = await toolsClient.market.connectListConnections.query();

        return response.connections.map((conn: any) => ({
          cachedAt: Date.now(),
          icon: conn.icon,
          identifier: conn.providerId,
          isConnected: true,
          name: conn.providerName,
          providerUsername: conn.providerUsername,
          scopes: conn.scopes,
          status: MarketConnectStatus.CONNECTED,
          tokenExpiresAt: conn.tokenExpiresAt,
        }));
      },
      {
        fallbackData: [],
        onSuccess: (data) => {
          if (data.length > 0) {
            set(
              produce((draft: MarketConnectStoreState) => {
                const existingIds = new Set(draft.marketConnectServers.map((s) => s.identifier));
                const newServers = data.filter((s) => !existingIds.has(s.identifier));
                draft.marketConnectServers = [...draft.marketConnectServers, ...newServers];
              }),
              false,
              n('useFetchMarketConnectConnections'),
            );

            for (const server of data) {
              get().refreshMarketConnectTools(server.identifier);
            }
          }
        },
        revalidateOnFocus: false,
      },
    ),
});

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
   * 调用 Klavis 工具
   */
  callKlavisTool: (params: CallKlavisToolParams) => Promise<CallKlavisToolResult>;

  /**
   * 完成 OAuth 认证后，更新服务器状态
   * @param identifier - 服务器标识符 (e.g., 'google-calendar')
   */
  completeKlavisServerAuth: (identifier: string) => Promise<void>;

  /**
   * 创建单个 Klavis MCP Server 实例
   * @returns 创建的服务器实例，如果需要 OAuth 则返回带 oauthUrl 的对象
   */
  createKlavisServer: (params: CreateKlavisServerParams) => Promise<KlavisServer | undefined>;

  /**
   * 刷新 Klavis Server 的工具列表
   * @param identifier - 服务器标识符 (e.g., 'google-calendar')
   */
  refreshKlavisServerTools: (identifier: string) => Promise<void>;

  /**
   * 删除 Klavis Server
   * @param identifier - 服务器标识符 (e.g., 'google-calendar')
   */
  removeKlavisServer: (identifier: string) => Promise<void>;

  /**
   * 使用 SWR 获取用户的 Klavis 服务器列表
   * @param enabled - 是否启用获取
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
      // 调用 tRPC 服务端接口执行工具（使用 toolsClient 以获得更长的超时时间）
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
    // OAuth 完成后，刷新工具列表
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
      // 调用 tRPC 服务端接口创建单个服务器实例
      const response = await lambdaClient.klavis.createServerInstance.mutate({
        identifier,
        serverName,
        userId,
      });

      // 构建服务器对象
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

      // 添加到 servers 列表
      set(
        produce((draft: KlavisStoreState) => {
          // 检查是否已存在（使用 identifier），如果存在则更新
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

    // 使用 identifier 查找服务器
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
      // 首先检查服务器的认证状态
      const instanceStatus = await lambdaClient.klavis.getServerInstance.query({
        instanceId: server.instanceId,
      });

      // 如果认证失败，删除服务器并重置状态
      if (!instanceStatus.isAuthenticated) {
        if (!instanceStatus.authNeeded) {
          // 如果不需要认证，说明没问题
          return;
        }

        // 从本地状态移除（使用 identifier）
        set(
          produce((draft: KlavisStoreState) => {
            draft.servers = draft.servers.filter((s) => s.identifier !== identifier);
            draft.loadingServerIds.delete(identifier);
          }),
          false,
          n('refreshKlavisServerTools/authFailed'),
        );

        // 从数据库删除
        await lambdaClient.klavis.deleteServerInstance.mutate({
          identifier,
          instanceId: server.instanceId,
        });

        return;
      }

      // 认证成功，获取工具列表（使用 toolsClient 以获得更长的超时时间）
      const response = await toolsClient.klavis.listTools.query({
        serverUrl: server.serverUrl,
      });

      const tools = response.tools as KlavisTool[];

      set(
        produce((draft: KlavisStoreState) => {
          // 使用 identifier 查找服务器
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

      // 更新数据库中的工具列表和认证状态
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
          // 使用 identifier 查找服务器
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
    // 使用 identifier 查找服务器
    const server = servers.find((s) => s.identifier === identifier);

    set(
      produce((draft: KlavisStoreState) => {
        // 使用 identifier 过滤
        draft.servers = draft.servers.filter((s) => s.identifier !== identifier);
      }),
      false,
      n('removeKlavisServer'),
    );

    // 从 Klavis API 和数据库删除
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

        // 转换为 KlavisServer 对象
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
                // 使用 identifier 检查是否已存在
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

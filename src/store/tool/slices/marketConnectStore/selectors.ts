import { type ToolStore } from '../../store';
import { type MarketConnectServer, MarketConnectStatus } from './types';

/**
 * Market Connect Store Selectors
 */
export const marketConnectStoreSelectors = {
  /**
   * 获取所有 Market Connect 服务器的 identifier 集合
   */
  getAllServerIdentifiers: (s: ToolStore): Set<string> => {
    const servers = s.marketConnectServers || [];
    return new Set(servers.map((server) => server.identifier));
  },

  /**
   * 获取所有可用的工具（来自所有已连接的服务器）
   */
  getAllTools: (s: ToolStore) => {
    const connectedServers = marketConnectStoreSelectors.getConnectedServers(s);
    return connectedServers.flatMap((server) =>
      (server.tools || []).map((tool) => ({
        ...tool,
        provider: server.identifier,
      })),
    );
  },

  /**
   * 获取所有已连接的服务器
   */
  getConnectedServers: (s: ToolStore): MarketConnectServer[] =>
    (s.marketConnectServers || []).filter(
      (server) => server.status === MarketConnectStatus.CONNECTED,
    ),

  /**
   * 根据 identifier 获取服务器
   * @param identifier - Provider 标识符 (e.g., 'linear')
   */
  getServerByIdentifier: (identifier: string) => (s: ToolStore) =>
    s.marketConnectServers?.find((server) => server.identifier === identifier),

  /**
   * 获取所有 Market Connect 服务器
   */
  getServers: (s: ToolStore): MarketConnectServer[] => s.marketConnectServers || [],

  /**
   * 检查给定的 identifier 是否是 Market Connect 服务器
   * @param identifier - Provider 标识符 (e.g., 'linear')
   */
  isMarketConnectServer:
    (identifier: string) =>
    (s: ToolStore): boolean => {
      const servers = s.marketConnectServers || [];
      return servers.some((server) => server.identifier === identifier);
    },

  /**
   * 检查服务器是否正在加载
   * @param identifier - Provider 标识符 (e.g., 'linear')
   */
  isServerLoading: (identifier: string) => (s: ToolStore) =>
    s.marketConnectLoadingIds?.has(identifier) || false,

  /**
   * 检查工具是否正在执行
   */
  isToolExecuting: (provider: string, toolName: string) => (s: ToolStore) => {
    const toolId = `${provider}:${toolName}`;
    return s.marketConnectExecutingToolIds?.has(toolId) || false;
  },

  /**
   * Get all Market Connect tools as LobeTool format for agent use
   * Converts Market Connect tools into the format expected by ToolNameResolver
   */
  marketConnectAsLobeTools: (s: ToolStore) => {
    const servers = s.marketConnectServers || [];
    const tools: any[] = [];

    for (const server of servers) {
      if (!server.tools || server.status !== MarketConnectStatus.CONNECTED) continue;

      const apis = server.tools.map((tool) => ({
        description: tool.description || '',
        name: tool.name,
        parameters: tool.inputSchema || {},
      }));

      if (apis.length > 0) {
        tools.push({
          identifier: server.identifier,
          manifest: {
            api: apis,
            author: 'LobeHub Market',
            homepage: 'https://lobehub.com/market',
            identifier: server.identifier,
            meta: {
              avatar: server.icon || '🔗',
              description: `Market Connect: ${server.name}`,
              tags: ['market-connect', server.identifier],
              title: server.name,
            },
            type: 'builtin',
            version: '1.0.0',
          },
          type: 'plugin',
        });
      }
    }

    return tools;
  },
};

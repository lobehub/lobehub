import { type ToolStore } from '../../store';
import { type KlavisServer, KlavisServerStatus } from './types';

/**
 * Klavis Store Selectors
 */
export const klavisStoreSelectors = {
  /**
   * 获取所有 Klavis 服务器的 identifier 集合
   */
  getAllServerIdentifiers: (s: ToolStore): Set<string> => {
    const servers = s.servers || [];
    return new Set(servers.map((server) => server.identifier));
  },

  /**
   * 获取所有可用的工具（来自所有已连接的服务器）
   */
  getAllTools: (s: ToolStore) => {
    const connectedServers = klavisStoreSelectors.getConnectedServers(s);
    return connectedServers.flatMap((server) =>
      (server.tools || []).map((tool) => ({
        ...tool,
        // 工具仍然需要 serverName 用于 API 调用
        serverName: server.serverName,
      })),
    );
  },

  /**
   * 获取所有已连接的服务器
   */
  getConnectedServers: (s: ToolStore): KlavisServer[] =>
    (s.servers || []).filter((server) => server.status === KlavisServerStatus.CONNECTED),

  /**
   * 获取所有待认证的服务器
   */
  getPendingAuthServers: (s: ToolStore): KlavisServer[] =>
    (s.servers || []).filter((server) => server.status === KlavisServerStatus.PENDING_AUTH),

  /**
   * 根据 identifier 获取服务器
   * @param identifier - 服务器标识符 (e.g., 'google-calendar')
   */
  getServerByIdentifier: (identifier: string) => (s: ToolStore) =>
    s.servers?.find((server) => server.identifier === identifier),

  /**
   * 获取所有 Klavis 服务器
   */
  getServers: (s: ToolStore): KlavisServer[] => s.servers || [],

  /**
   * 检查给定的 identifier 是否是 Klavis 服务器
   * @param identifier - 服务器标识符 (e.g., 'google-calendar')
   */
  isKlavisServer:
    (identifier: string) =>
    (s: ToolStore): boolean => {
      const servers = s.servers || [];
      return servers.some((server) => server.identifier === identifier);
    },

  /**
   * 检查服务器是否正在加载
   * @param identifier - 服务器标识符 (e.g., 'google-calendar')
   */
  isServerLoading: (identifier: string) => (s: ToolStore) =>
    s.loadingServerIds?.has(identifier) || false,

  /**
   * 检查工具是否正在执行
   */
  isToolExecuting: (serverUrl: string, toolName: string) => (s: ToolStore) => {
    const toolId = `${serverUrl}:${toolName}`;
    return s.executingToolIds?.has(toolId) || false;
  },

  /**
   * Get all Klavis tools as LobeTool format for agent use
   * Converts Klavis tools into the format expected by ToolNameResolver
   */
  klavisAsLobeTools: (s: ToolStore) => {
    const servers = s.servers || [];
    const tools: any[] = [];

    servers.forEach((server) => {
      if (!server.tools || server.status !== KlavisServerStatus.CONNECTED) return;

      // Create a manifest for this server that contains all its tools
      const apis = server.tools.map((tool) => ({
        description: tool.description || '',
        name: tool.name,
        parameters: tool.inputSchema || {},
      }));

      if (apis.length > 0) {
        tools.push({
          // 使用 identifier 作为存储和引用的标识符
          identifier: server.identifier,
          manifest: {
            api: apis,
            author: 'Klavis',
            homepage: 'https://klavis.ai',
            identifier: server.identifier,
            meta: {
              avatar: '☁️',
              description: `LobeHub Mcp Server: ${server.serverName}`,
              tags: ['klavis', 'mcp'],
              title: server.serverName,
            },
            type: 'builtin',
            version: '1.0.0',
          },
          type: 'plugin',
        });
      }
    });

    return tools;
  },
};

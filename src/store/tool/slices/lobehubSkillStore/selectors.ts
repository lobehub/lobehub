import { type ToolStoreState } from '../../initialState';
import { type LobehubSkillServer } from './types';
import { LobehubSkillStatus } from './types';

/**
 * LobeHub Skill Store Selectors
 */
export const lobehubSkillStoreSelectors = {
  /**
   * 获取所有 LobeHub Skill 服务器的 identifier 集合
   */
  getAllServerIdentifiers: (s: ToolStoreState): Set<string> => {
    const servers = s.lobehubSkillServers || [];
    return new Set(servers.map((server) => server.identifier));
  },

  /**
   * 获取所有可用的工具（来自所有已连接的服务器）
   */
  getAllTools: (s: ToolStoreState) => {
    const connectedServers = lobehubSkillStoreSelectors.getConnectedServers(s);
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
  getConnectedServers: (s: ToolStoreState): LobehubSkillServer[] =>
    (s.lobehubSkillServers || []).filter(
      (server) => server.status === LobehubSkillStatus.CONNECTED,
    ),

  /**
   * 根据 identifier 获取服务器
   * @param identifier - Provider 标识符 (e.g., 'linear')
   */
  getServerByIdentifier: (identifier: string) => (s: ToolStoreState) =>
    s.lobehubSkillServers?.find((server) => server.identifier === identifier),

  /**
   * 获取所有 LobeHub Skill 服务器
   */
  getServers: (s: ToolStoreState): LobehubSkillServer[] => s.lobehubSkillServers || [],

  /**
   * 检查给定的 identifier 是否是 LobeHub Skill 服务器
   * @param identifier - Provider 标识符 (e.g., 'linear')
   */
  isLobehubSkillServer:
    (identifier: string) =>
    (s: ToolStoreState): boolean => {
      const servers = s.lobehubSkillServers || [];
      return servers.some((server) => server.identifier === identifier);
    },

  /**
   * 检查服务器是否正在加载
   * @param identifier - Provider 标识符 (e.g., 'linear')
   */
  isServerLoading: (identifier: string) => (s: ToolStoreState) =>
    s.lobehubSkillLoadingIds?.has(identifier) || false,

  /**
   * 检查工具是否正在执行
   */
  isToolExecuting: (provider: string, toolName: string) => (s: ToolStoreState) => {
    const toolId = `${provider}:${toolName}`;
    return s.lobehubSkillExecutingToolIds?.has(toolId) || false;
  },

  /**
   * Get all LobeHub Skill tools as LobeTool format for agent use
   * Converts LobeHub Skill tools into the format expected by ToolNameResolver
   */
  lobehubSkillAsLobeTools: (s: ToolStoreState) => {
    const servers = s.lobehubSkillServers || [];
    const tools: any[] = [];

    for (const server of servers) {
      if (!server.tools || server.status !== LobehubSkillStatus.CONNECTED) continue;

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
              description: `LobeHub Skill: ${server.name}`,
              tags: ['lobehub-skill', server.identifier],
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

  /**
   * Get metadata list for all connected LobeHub Skill servers
   * Used by toolSelectors.metaList for unified tool metadata resolution
   */
  metaList: (s: ToolStoreState) => {
    const servers = s.lobehubSkillServers || [];

    return servers
      .filter((server) => server.status === LobehubSkillStatus.CONNECTED)
      .map((server) => ({
        identifier: server.identifier,
        meta: {
          avatar: server.icon || '🔗',
          description: `LobeHub Skill: ${server.name}`,
          title: server.name,
        },
      }));
  },
};

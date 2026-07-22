import urlJoin from 'url-join';

import { OFFICIAL_SITE } from '@/const/url';

import { type ToolStoreState } from '../../initialState';
import { scopedBucket } from '../../workspaceScope';
import { type LobehubSkillServer } from './types';
import { LobehubSkillStatus } from './types';

/**
 * Single scoped read for every selector below. These connections come from the
 * Market service keyed by the user's identity, so the same set comes back in
 * every workspace; the scope stamp is what stops one workspace's fetch from
 * being rendered inside another.
 */
const servers = (s: ToolStoreState): LobehubSkillServer[] =>
  scopedBucket(s, 'lobehubSkillServers', s.lobehubSkillServers);

/**
 * LobeHub Skill Store Selectors
 */
export const lobehubSkillStoreSelectors = {
  /**
   * Get all LobeHub Skill server identifiers as a set
   */
  getAllServerIdentifiers: (s: ToolStoreState): Set<string> =>
    new Set(servers(s).map((server) => server.identifier)),

  /**
   * Get all available tools from all connected servers
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
   * Get all connected servers
   */
  getConnectedServers: (s: ToolStoreState): LobehubSkillServer[] =>
    servers(s).filter((server) => server.status === LobehubSkillStatus.CONNECTED),

  /**
   * Get server by identifier
   * @param identifier - Provider identifier (e.g., 'linear')
   */
  getServerByIdentifier: (identifier: string) => (s: ToolStoreState) =>
    servers(s).find((server) => server.identifier === identifier),

  /**
   * Get all LobeHub Skill servers
   */
  getServers: (s: ToolStoreState): LobehubSkillServer[] => servers(s),

  /**
   * Check if the given identifier is a LobeHub Skill server
   * @param identifier - Provider identifier (e.g., 'linear')
   */
  isLobehubSkillServer:
    (identifier: string) =>
    (s: ToolStoreState): boolean =>
      servers(s).some((server) => server.identifier === identifier),

  /**
   * Check if a server is loading
   * @param identifier - Provider identifier (e.g., 'linear')
   */
  isServerLoading: (identifier: string) => (s: ToolStoreState) =>
    s.lobehubSkillLoadingIds?.has(identifier) || false,

  /**
   * Check if a tool is currently executing
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
    const tools: any[] = [];

    for (const server of servers(s)) {
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
            homepage: urlJoin(OFFICIAL_SITE, 'market'),
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
  metaList: (s: ToolStoreState) =>
    servers(s)
      .filter((server) => server.status === LobehubSkillStatus.CONNECTED)
      .map((server) => ({
        identifier: server.identifier,
        meta: {
          avatar: server.icon || '🔗',
          description: `LobeHub Skill: ${server.name}`,
          title: server.name,
        },
      })),
};

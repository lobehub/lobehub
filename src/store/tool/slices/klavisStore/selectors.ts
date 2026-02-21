import { type ToolStore } from '../../store';
import { type KlavisServer } from './types';
import { KlavisServerStatus } from './types';

/**
 * Klavis Store Selectors
 */
export const klavisStoreSelectors = {
  /**
   * Get identifier set of all Klavis servers
   */
  getAllServerIdentifiers: (s: ToolStore): Set<string> => {
    const servers = s.servers || [];
    return new Set(servers.map((server) => server.identifier));
  },

  /**
   * Get all available tools (from all connected servers)
   */
  getAllTools: (s: ToolStore) => {
    const connectedServers = klavisStoreSelectors.getConnectedServers(s);
    return connectedServers.flatMap((server) =>
      (server.tools || []).map((tool) => ({
        ...tool,
        // Tool still needs serverName for API calls
        serverName: server.serverName,
      })),
    );
  },

  /**
   * Get all connected servers
   */
  getConnectedServers: (s: ToolStore): KlavisServer[] =>
    (s.servers || []).filter((server) => server.status === KlavisServerStatus.CONNECTED),

  /**
   * Get all servers pending authentication
   */
  getPendingAuthServers: (s: ToolStore): KlavisServer[] =>
    (s.servers || []).filter((server) => server.status === KlavisServerStatus.PENDING_AUTH),

  /**
   * Get server by identifier
   * @param identifier - Server identifier (e.g., 'google-calendar')
   */
  getServerByIdentifier: (identifier: string) => (s: ToolStore) =>
    s.servers?.find((server) => server.identifier === identifier),

  /**
   * Get all Klavis servers
   */
  getServers: (s: ToolStore): KlavisServer[] => s.servers || [],

  /**
   * Check if given identifier is a Klavis server
   * @param identifier - Server identifier (e.g., 'google-calendar')
   */
  isKlavisServer:
    (identifier: string) =>
    (s: ToolStore): boolean => {
      const servers = s.servers || [];
      return servers.some((server) => server.identifier === identifier);
    },

  /**
   * Check if server is loading
   * @param identifier - Server identifier (e.g., 'google-calendar')
   */
  isServerLoading: (identifier: string) => (s: ToolStore) =>
    s.loadingServerIds?.has(identifier) || false,

  /**
   * Check if tool is executing
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
          // Use identifier as storage and reference identifier
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

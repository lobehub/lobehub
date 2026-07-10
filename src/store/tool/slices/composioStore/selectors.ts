import { type ToolStore } from '../../store';
import { type ComposioServer, ComposioServerStatus } from './types';

export const composioStoreSelectors = {
  getAllServerIdentifiers: (s: ToolStore): Set<string> => {
    const servers = s.composioServers || [];
    return new Set(servers.map((server) => server.identifier));
  },

  getAllTools: (s: ToolStore) => {
    const connectedServers = composioStoreSelectors.getConnectedServers(s);
    return connectedServers.flatMap((server) =>
      (server.tools || []).map((tool) => ({
        ...tool,
        appSlug: server.appSlug,
      })),
    );
  },

  getConnectedServers: (s: ToolStore): ComposioServer[] =>
    (s.composioServers || []).filter((server) => server.status === ComposioServerStatus.ACTIVE),

  getPendingAuthServers: (s: ToolStore): ComposioServer[] =>
    (s.composioServers || []).filter(
      (server) => server.status === ComposioServerStatus.PENDING_AUTH,
    ),

  getServerByIdentifier: (identifier: string) => (s: ToolStore) =>
    s.composioServers?.find((server) => server.identifier === identifier),

  getServers: (s: ToolStore): ComposioServer[] => s.composioServers || [],

  isComposioServer:
    (identifier: string) =>
    (s: ToolStore): boolean => {
      const servers = s.composioServers || [];
      return servers.some((server) => server.identifier === identifier);
    },

  isServerLoading: (identifier: string) => (s: ToolStore) =>
    s.loadingComposioServerIds?.has(identifier) || false,

  isToolExecuting: (connectedAccountId: string, toolSlug: string) => (s: ToolStore) => {
    const toolId = `${connectedAccountId}:${toolSlug}`;
    return s.composioExecutingToolIds?.has(toolId) || false;
  },

  composioAsLobeTools: (s: ToolStore) => {
    const servers = s.composioServers || [];
    const tools: any[] = [];

    servers.forEach((server) => {
      if (!server.tools || server.status !== ComposioServerStatus.ACTIVE) return;

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
            author: 'Composio',
            homepage: 'https://composio.dev',
            identifier: server.identifier,
            meta: {
              avatar: '☁️',
              description: `Composio: ${server.label}`,
              tags: ['composio', 'mcp'],
              title: server.label,
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

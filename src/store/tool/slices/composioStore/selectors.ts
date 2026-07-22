import { type ToolStore } from '../../store';
import { scopedBucket } from '../../workspaceScope';
import { type ComposioServer, ComposioServerStatus } from './types';

/**
 * Every read goes through here so a bucket fetched under another workspace can
 * never reach the UI — showing the user's PERSONAL Composio connections inside
 * a workspace is what made the chat tool list and `/settings/connector` claim
 * integrations that the workspace agent then failed to resolve at run time.
 */
const servers = (s: ToolStore): ComposioServer[] =>
  scopedBucket(s, 'composioServers', s.composioServers);

export const composioStoreSelectors = {
  getAllServerIdentifiers: (s: ToolStore): Set<string> =>
    new Set(servers(s).map((server) => server.identifier)),

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
    servers(s).filter((server) => server.status === ComposioServerStatus.ACTIVE),

  getPendingAuthServers: (s: ToolStore): ComposioServer[] =>
    servers(s).filter((server) => server.status === ComposioServerStatus.PENDING_AUTH),

  getServerByIdentifier: (identifier: string) => (s: ToolStore) =>
    servers(s).find((server) => server.identifier === identifier),

  getServers: (s: ToolStore): ComposioServer[] => servers(s),

  isComposioServer:
    (identifier: string) =>
    (s: ToolStore): boolean =>
      servers(s).some((server) => server.identifier === identifier),

  isServerLoading: (identifier: string) => (s: ToolStore) =>
    s.loadingComposioServerIds?.has(identifier) || false,

  isToolExecuting: (connectedAccountId: string, toolSlug: string) => (s: ToolStore) => {
    const toolId = `${connectedAccountId}:${toolSlug}`;
    return s.composioExecutingToolIds?.has(toolId) || false;
  },

  composioAsLobeTools: (s: ToolStore) => {
    const tools: any[] = [];

    servers(s).forEach((server) => {
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

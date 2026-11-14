import type { ToolManifest } from '@lobechat/types';
import debug from 'debug';

const log = debug('lobe-mcp:store:cloudManifest');

/**
 * Build manifest for cloud MCP connection from market data
 */
export const buildCloudMcpManifest = (params: {
  data: any;
  plugin: { description?: string; icon?: string; identifier: string };
}): ToolManifest => {
  const { data, plugin } = params;

  log('Using cloud connection, building manifest from market data');

  // Get tools (MCP format) or api (LobeChat format) from data
  const mcpTools = data.tools;
  const lobeChatApi = data.api;

  // If MCP format tools, need to convert to LobeChat api format
  // MCP: { name, description, inputSchema }
  // LobeChat: { name, description, parameters }
  let apiArray: any[] = [];

  if (lobeChatApi) {
    // Already in LobeChat format, use directly
    apiArray = lobeChatApi;
    log('[Cloud MCP] Using existing LobeChat API format');
  } else if (mcpTools && Array.isArray(mcpTools)) {
    // Convert MCP tools format to LobeChat api format
    apiArray = mcpTools.map((tool: any) => ({
      description: tool.description || '',
      name: tool.name,
      parameters: tool.inputSchema || {},
    }));
    log('[Cloud MCP] Converted %d MCP tools to LobeChat API format', apiArray.length);
  } else {
    console.warn('[Cloud MCP] No tools or api found in manifest data');
  }

  // Build complete manifest
  const manifest: ToolManifest = {
    api: apiArray,
    author: data.author?.name || data.author || '',
    createAt: data.createdAt || new Date().toISOString(),
    homepage: data.homepage || '',
    identifier: plugin.identifier,
    manifest: data.manifestUrl || '',
    meta: {
      avatar: data.icon || plugin.icon,
      description: plugin.description || data.description,
      tags: data.tags || [],
      title: data.name || plugin.identifier,
    },
    name: data.name || plugin.identifier,
    type: 'mcp',
    version: data.version,
  } as unknown as ToolManifest;

  log('[Cloud MCP] Final manifest built:', {
    apiCount: manifest.api?.length,
    identifier: manifest.identifier,
    version: manifest.version,
  });

  return manifest;
};

/**
 * A cloud server's tools as `connector.syncToolsFromClientById` stores them.
 * The manifest's `humanIntervention` carries over, so a tool the market marks
 * `required` / `always` is synced as needing approval.
 */
export const cloudManifestTools = (manifest: ToolManifest) =>
  (manifest.api ?? []).map((api) => ({
    description: api.description,
    humanIntervention: api.humanIntervention,
    inputSchema: api.parameters as Record<string, unknown>,
    toolName: api.name,
  }));

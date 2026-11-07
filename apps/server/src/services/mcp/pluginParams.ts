import type { LobeTool } from '@lobechat/types';

import type { MCPClientParams } from '@/libs/mcp';

/** The installed/custom-plugin route uses the same private configuration on initial and resumed calls. */
export function buildPluginMcpParams(
  plugin: Pick<LobeTool, 'identifier' | 'customParams' | 'settings'>,
): MCPClientParams | undefined {
  const connection = plugin.customParams?.mcp;
  if (!connection || (connection.type !== 'http' && connection.type !== 'stdio')) return;
  const settings = Object.fromEntries(
    Object.entries(plugin.settings ?? {}).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
  return {
    ...connection,
    name: plugin.identifier,
    ...(connection.type === 'http'
      ? { headers: { ...connection.headers, ...settings } }
      : { env: { ...connection.env, ...settings } }),
  } as MCPClientParams;
}

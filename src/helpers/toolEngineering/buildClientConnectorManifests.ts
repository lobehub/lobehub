import { type ToolManifest } from '@lobechat/types';

import { ConnectorToolPermission } from '@/database/schemas';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/**
 * Convert connector store rows into ToolManifest entries for the classic
 * (client-orchestrated) chat path, mirroring the server-side
 * `buildConnectorManifests`. The manifest carries no `mcpParams`/auth — the
 * client has no token; connector tool calls are executed server-side via
 * `connector.callTool`, which decrypts the stored credentials.
 *
 * Permission mapping:
 * - 'auto'           → humanIntervention undefined (AI calls freely)
 * - 'needs_approval' → humanIntervention 'required'
 * - 'disabled'       → tool included with a blocking description
 */
export const buildClientConnectorManifests = (connectors: ConnectorWithTools[]): ToolManifest[] => {
  const manifests: ToolManifest[] = [];

  for (const connector of connectors) {
    if (!connector.isEnabled) continue;
    const tools = connector.tools ?? [];
    if (tools.length === 0) continue;

    const api = tools.map((t) => {
      const parameters = (t.inputSchema ?? { properties: {}, type: 'object' }) as Record<
        string,
        unknown
      >;
      if (t.permission === ConnectorToolPermission.disabled) {
        return {
          description:
            `[TOOL DISABLED] The user has disabled this tool and it cannot be executed. ` +
            `Do NOT call this tool. If the user asks to perform this action, inform them ` +
            `that they have manually disabled "${t.toolName}" and can re-enable it in Settings > Connectors.`,
          humanIntervention: 'required' as const,
          name: t.toolName,
          parameters,
        };
      }
      return {
        description: t.description ?? '',
        humanIntervention:
          t.permission === ConnectorToolPermission.needs_approval
            ? ('required' as const)
            : undefined,
        name: t.toolName,
        parameters,
      };
    });

    manifests.push({
      api,
      identifier: connector.identifier,
      meta: {
        avatar: 'MCP_AVATAR',
        description: `${connector.name} connector with ${api.length} tools`,
        title: connector.name,
      },
      type: 'mcp' as any,
    });
  }

  return manifests;
};

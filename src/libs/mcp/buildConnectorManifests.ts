import type { ToolManifest } from '@lobechat/types';

import type { DecryptedConnector } from '@/database/models/connector';
import type { UserConnectorToolItem } from '@/database/schemas';
import { ConnectorToolPermission } from '@/database/schemas';

/**
 * Convert connector DB rows into ToolManifest entries suitable for
 * injection into the server AgentToolsEngine as additionalManifests.
 *
 * Permission mapping:
 * - 'auto'           → humanIntervention: undefined (AI calls freely)
 * - 'needs_approval' → humanIntervention: 'required' (human must confirm)
 * - 'disabled'       → tool included with blocking description; AI knows it exists but is told it cannot be called
 */
export function buildConnectorManifests(
  connectors: DecryptedConnector[],
  tools: UserConnectorToolItem[],
): ToolManifest[] {
  const toolsByConnector = new Map<string, UserConnectorToolItem[]>();
  for (const tool of tools) {
    const list = toolsByConnector.get(tool.userConnectorId) ?? [];
    list.push(tool);
    toolsByConnector.set(tool.userConnectorId, list);
  }

  const manifests: ToolManifest[] = [];

  for (const connector of connectors) {
    if (!connector.isEnabled) continue;

    const connectorTools = toolsByConnector.get(connector.id) ?? [];

    // Include ALL tools in the manifest so the AI is aware of their existence.
    // Disabled tools get a blocking description so the AI knows not to call them.
    // At execution time, the callTool endpoint will double-check and hard-block disabled tools.
    if (connectorTools.length === 0) continue;

    const api = connectorTools.map((t) => {
      if (t.permission === ConnectorToolPermission.disabled) {
        return {
          description:
            `[TOOL DISABLED] The user has disabled this tool and it cannot be executed. ` +
            `Do NOT call this tool. If the user asks to perform this action, inform them ` +
            `that they have manually disabled "${t.toolName}" and can re-enable it in Settings > Connectors.`,
          humanIntervention: 'required' as const,
          name: t.toolName,
          parameters: (t.inputSchema ?? { properties: {}, type: 'object' }) as Record<
            string,
            unknown
          >,
        };
      }
      return {
        description: t.description ?? '',
        humanIntervention:
          t.permission === ConnectorToolPermission.needs_approval
            ? ('required' as const)
            : undefined,
        name: t.toolName,
        parameters: (t.inputSchema ?? { properties: {}, type: 'object' }) as Record<
          string,
          unknown
        >,
      };
    });

    const mcpParams = buildMcpParams(connector);

    manifests.push({
      api,
      identifier: connector.identifier,
      // @ts-ignore — mcpParams is a runtime-only field not in the public type
      mcpParams,
      meta: {
        avatar: 'MCP_AVATAR',
        description: `${connector.name} connector with ${api.length} tools`,
        title: connector.name,
      },
      type: 'mcp' as any,
    });
  }

  return manifests;
}

function buildMcpParams(connector: DecryptedConnector) {
  const auth = buildAuthFromCredentials(connector);

  if (connector.mcpConnectionType === 'stdio') {
    return {
      args: connector.mcpStdioConfig?.args ?? [],
      command: connector.mcpStdioConfig?.command ?? '',
      env: connector.mcpStdioConfig?.env,
      name: connector.identifier,
      type: 'stdio' as const,
    };
  }

  return {
    auth,
    name: connector.identifier,
    type: 'http' as const,
    url: connector.mcpServerUrl ?? '',
  };
}

function buildAuthFromCredentials(connector: DecryptedConnector) {
  const creds = connector.credentials;
  if (!creds) return undefined;

  switch (creds.type) {
    case 'oauth2': {
      return { accessToken: creds.accessToken, type: 'oauth2' as const };
    }
    case 'bearer': {
      return { token: creds.token, type: 'bearer' as const };
    }
    default: {
      return undefined;
    }
  }
}

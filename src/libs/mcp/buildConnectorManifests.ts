import { buildConnectorManifest } from '@lobechat/mecha';
import type { ToolManifest } from '@lobechat/types';

import type { DecryptedConnector } from '@/database/models/connector';
import type { UserConnectorToolItem } from '@/database/schemas';

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
    // The listing and the permission mapping are the shared rule; the server
    // adds the endpoint and credentials the runtime needs to call it.
    const manifest = buildConnectorManifest({
      identifier: connector.identifier,
      isEnabled: connector.isEnabled,
      name: connector.name,
      tools: toolsByConnector.get(connector.id) ?? [],
    });
    if (!manifest) continue;

    manifests.push({
      ...(manifest as ToolManifest),
      // @ts-ignore — mcpParams is a runtime-only field not in the public type
      mcpParams: buildMcpParams(connector),
    });
  }

  return manifests;
}

function buildMcpParams(connector: DecryptedConnector) {
  if (connector.mcpConnectionType === 'stdio') {
    return {
      args: connector.mcpStdioConfig?.args ?? [],
      command: connector.mcpStdioConfig?.command ?? '',
      env: connector.mcpStdioConfig?.env,
      name: connector.identifier,
      type: 'stdio' as const,
    };
  }

  const { auth, headers } = buildHttpAuthFromCredentials(connector.credentials);
  // Custom headers live in `metadata.customHeaders` (independent of the
  // single-kind `credentials` column) so they can coexist with bearer/no-auth.
  // Merge them on top of any header-type credential headers (legacy rows), to
  // mirror the sync/callTool path in services/connector/sync.ts.
  const customHeaders = connector.metadata?.customHeaders as Record<string, string> | undefined;
  const mergedHeaders = headers || customHeaders ? { ...headers, ...customHeaders } : undefined;

  return {
    auth,
    headers: mergedHeaders,
    name: connector.identifier,
    type: 'http' as const,
    url: connector.mcpServerUrl ?? '',
  };
}

/**
 * Map stored credentials into the HTTP MCP client's auth + custom headers.
 * bearer/apikey become bearer auth (Authorization: Bearer …); header is passed
 * through verbatim. OAuth2 only needs the access token at request time.
 */
function buildHttpAuthFromCredentials(creds: DecryptedConnector['credentials']) {
  if (!creds) return {};

  switch (creds.type) {
    case 'oauth2': {
      return { auth: { accessToken: creds.accessToken, type: 'oauth2' as const } };
    }
    case 'bearer': {
      return { auth: { token: creds.token, type: 'bearer' as const } };
    }
    case 'apikey': {
      return { auth: { token: creds.apiKey, type: 'bearer' as const } };
    }
    case 'header': {
      return { headers: creds.headers };
    }
    default: {
      return {};
    }
  }
}

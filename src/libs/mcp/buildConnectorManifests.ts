import { buildConnectorManifest, resolveConnectorLinkParam } from '@lobechat/mecha';
import { needsConnectorReauthorization, type ToolManifest } from '@lobechat/types';
import { connectorConnectVia, connectorDeviceBinding } from '@lobechat/utils/mcpEndpoint';

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
 * A tool whose manifest made approval mandatory (`metadata.mandatoryApproval`)
 * is `humanIntervention: 'always'` unless disabled: auto-run cannot skip it.
 */
export function buildConnectorManifests(
  /**
   * Rows from `ConnectorModel.resolveToolSets` carry their tool prefix
   * (`toolIdentifier`): each becomes its own manifest under it. Rows without
   * one are keyed by their identifier.
   */
  connectors: (DecryptedConnector & { toolIdentifier?: string })[],
  tools: UserConnectorToolItem[],
  mcpApps = false,
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
    const manifest = buildConnectorManifest(
      {
        id: connector.id,
        identifier: connector.identifier,
        isEnabled: connector.isEnabled,
        name: connector.name,
        links: connector.links,
        toolIdentifier: connector.toolIdentifier,
        tools: toolsByConnector.get(connector.id) ?? [],
      },
      mcpApps,
    );
    if (!manifest) continue;

    const reauthorizationRequired = needsConnectorReauthorization(connector.credentials);
    manifests.push({
      ...(manifest as ToolManifest),
      // @ts-ignore — mcpParams is a runtime-only field not in the public type
      mcpParams: buildMcpParams(
        reauthorizationRequired || (connector.links?.length ?? 0) > 1
          ? { ...connector, credentials: null }
          : connector,
      ),
      ...(reauthorizationRequired && { connectorReauthorizationRequired: true }),
      ...((connector.links?.length ?? 0) > 1
        ? {
            connectorLinks: {
              connectorId: connector.id,
              param: resolveConnectorLinkParam(
                (toolsByConnector.get(connector.id) ?? []).map((tool) => tool.inputSchema),
              ),
            },
          }
        : {}),
    });
  }

  return manifests;
}

function buildMcpParams(connector: DecryptedConnector) {
  // Only set when bound, so an unbound connector keeps the params it always
  // had. Must match `buildConnectorMcpParams`.
  const boundDevice = connectorDeviceBinding(connector);
  if (connector.mcpConnectionType === 'stdio') {
    return {
      args: connector.mcpStdioConfig?.args ?? [],
      ...(boundDevice && { boundDevice }),
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

  // A marketplace stdio server the market hosts: the tool executor calls it
  // through the market's cloud gateway by identifier.
  if (connector.mcpConnectionType === 'cloud') {
    return {
      headers: mergedHeaders,
      name: connector.identifier,
      type: 'cloud' as const,
      url: (connector.metadata?.cloudEndPoint as string | undefined) ?? '',
    };
  }

  return {
    auth,
    ...(boundDevice && { boundDevice }),
    // Only set when chosen, so `auto` keeps the params (and the MCP session
    // cached by them) it always had. Must match `buildConnectorMcpParams`.
    ...(connectorConnectVia(connector.metadata) === 'device' && { connectVia: 'device' as const }),
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

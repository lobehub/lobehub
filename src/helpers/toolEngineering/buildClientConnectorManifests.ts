import { buildConnectorManifest } from '@lobechat/mecha';
import { connectorToolIdentifier, type ToolManifest } from '@lobechat/types';

import { getServerConfigStoreState, serverConfigSelectors } from '@/store/serverConfig';
import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/**
 * Convert connector store rows into ToolManifest entries for the classic
 * (client-orchestrated) chat path. The manifest carries no `mcpParams`/auth —
 * the client has no token; connector tool calls are executed server-side via
 * `connector.callTool`, which decrypts the stored credentials. The permission
 * mapping is the shared rule in `@lobechat/mecha`.
 *
 * Each row is its own tool set under its tool prefix (the server's
 * `toolIdentifier`, else `connectorToolIdentifier`): a private row beside the
 * shared one of its connector is offered under its own name.
 */
export const buildClientConnectorManifests = (connectors: ConnectorWithTools[]): ToolManifest[] => {
  // Named as the server names them: no own row reads as a listed identifier
  const reserved = new Set(connectors.map((connector) => connector.identifier));
  return connectors
    .map((connector) =>
      buildConnectorManifest(
        {
          id: connector.id,
          identifier: connector.identifier,
          isEnabled: connector.isEnabled,
          name: connector.name,
          links: connector.links,
          toolIdentifier:
            connector.toolIdentifier ?? connectorToolIdentifier(connector, undefined, reserved),
          tools: connector.tools ?? [],
        },
        !!getServerConfigStoreState() &&
          serverConfigSelectors.enableMcpApps(getServerConfigStoreState()!),
      ),
    )
    .filter((manifest): manifest is NonNullable<typeof manifest> => !!manifest)
    .map((manifest) => manifest as ToolManifest);
};

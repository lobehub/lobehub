import { buildConnectorManifest } from '@lobechat/mecha';
import { type ToolManifest } from '@lobechat/types';

import type { ConnectorWithTools } from '@/store/tool/slices/connector/types';

/**
 * Convert connector store rows into ToolManifest entries for the classic
 * (client-orchestrated) chat path. The manifest carries no `mcpParams`/auth —
 * the client has no token; connector tool calls are executed server-side via
 * `connector.callTool`, which decrypts the stored credentials. The permission
 * mapping is the shared rule in `@lobechat/mecha`.
 */
export const buildClientConnectorManifests = (connectors: ConnectorWithTools[]): ToolManifest[] =>
  connectors
    .map((connector) =>
      buildConnectorManifest({
        identifier: connector.identifier,
        isEnabled: connector.isEnabled,
        name: connector.name,
        tools: connector.tools ?? [],
      }),
    )
    .filter((manifest): manifest is NonNullable<typeof manifest> => !!manifest)
    .map((manifest) => manifest as ToolManifest);

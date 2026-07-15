import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { ConnectorModel } from '@/database/models/connector';
import { PluginModel } from '@/database/models/plugin';

const log = debug('lobe-server:composio-connected-ids');

/**
 * Composio service identifiers currently connected (ACTIVE) in the caller's
 * scope, read from BOTH sources of truth:
 *  - `user_installed_plugins` (legacy projection): personal / workspace *base*
 *    Composio connections.
 *  - `user_connectors` (`resolveAll`, agent + workspace aware): AGENT-scoped
 *    connections. These are intentionally NOT projected into the plugin table
 *    (that projection carries no `agent_id`), so a workspace-agent's Composio
 *    connection lives only on the connector row's `metadata.composio`.
 *
 * Without the connector union, an agent-scoped Composio connection reads as
 * "not connected", and the model re-runs `connectComposioService` (the OAuth
 * connect flow) instead of calling the already-authorized tool.
 */
export async function loadConnectedComposioIds(
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  agentId: string | undefined,
): Promise<Set<string>> {
  const validComposioIds = new Set(COMPOSIO_APP_TYPES.map((tool) => tool.identifier));
  const connected = new Set<string>();

  const pluginModel = new PluginModel(serverDB, userId, workspaceId);
  const allPlugins = await pluginModel.query();
  for (const plugin of allPlugins) {
    if (
      validComposioIds.has(plugin.identifier) &&
      (plugin.customParams as any)?.composio?.status === 'ACTIVE'
    ) {
      connected.add(plugin.identifier);
    }
  }

  try {
    const connectorModel = new ConnectorModel(serverDB, userId, workspaceId);
    // Agent-aware: resolves the agent's own Composio connectors plus the base
    // (workspace/personal) ones, scoped by the model's workspace ownership.
    const connectors = await connectorModel.resolveAll(agentId);
    for (const connector of connectors) {
      if (
        connector.isEnabled &&
        validComposioIds.has(connector.identifier) &&
        connector.metadata?.composio?.status === 'ACTIVE'
      ) {
        connected.add(connector.identifier);
      }
    }
  } catch (error) {
    log('loadConnectedComposioIds: connector-based lookup failed: %O', error);
  }

  return connected;
}

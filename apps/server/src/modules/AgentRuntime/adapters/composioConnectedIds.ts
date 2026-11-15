import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { ConnectorModel, type ConnectorRunTarget } from '@/database/models/connector';
import { PluginModel } from '@/database/models/plugin';
import {
  selectLegacyComposioMirrors,
  VALID_COMPOSIO_IDENTIFIERS,
} from '@/server/services/composio/legacyMirrors';

const log = debug('lobe-server:composio-connected-ids');

/**
 * Composio service identifiers currently connected (ACTIVE) in the caller's
 * scope, read from BOTH sources of truth:
 *  - `user_installed_plugins` (legacy projection): personal / workspace *base*
 *    Composio connections created before the connector dual-write. Only the
 *    rows `ComposioService` would run (`selectLegacyComposioMirrors`) count: a
 *    projection row that mirrors a connector — e.g. a teammate's private one a
 *    workspace agent does not load — is that connector's, and is counted only
 *    when the run resolves the connector below.
 *  - `user_connectors` (`resolveAll`, agent + workspace + visibility aware):
 *    base and AGENT-scoped connections. Agent-scoped ones are intentionally NOT
 *    projected into the plugin table (that projection carries no `agent_id`),
 *    so a workspace-agent's Composio connection lives only on the connector
 *    row's `metadata.composio`.
 *
 * Counting a projection row the run cannot use would tell the model the
 * service is authorized ("use its tools directly") and drop it from the
 * services it can connect, while the run has no tool for it.
 *
 * Without the connector union, an agent-scoped Composio connection reads as
 * "not connected", and the model re-runs `connectComposioService` (the OAuth
 * connect flow) instead of calling the already-authorized tool.
 */
export async function loadConnectedComposioIds(
  serverDB: LobeChatDatabase,
  userId: string,
  workspaceId: string | undefined,
  target: ConnectorRunTarget,
): Promise<Set<string>> {
  const connected = new Set<string>();
  const connectorModel = new ConnectorModel(serverDB, userId, workspaceId);

  const pluginModel = new PluginModel(serverDB, userId, workspaceId);
  const legacyMirrors = await selectLegacyComposioMirrors(
    await pluginModel.queryComposioMirrors(),
    connectorModel,
  );
  for (const { plugin } of legacyMirrors) {
    if (plugin.customParams?.composio?.status === 'ACTIVE') connected.add(plugin.identifier);
  }

  try {
    // Agent-aware: resolves the agent's own Composio connectors plus the base
    // (workspace/personal) ones, scoped by the model's workspace ownership.
    const connectors = await connectorModel.resolveAll(target);
    for (const connector of connectors) {
      if (
        connector.isEnabled &&
        VALID_COMPOSIO_IDENTIFIERS.has(connector.identifier) &&
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

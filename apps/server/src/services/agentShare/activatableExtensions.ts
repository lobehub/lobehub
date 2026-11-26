import { isBuiltinToolIdentifier } from '@lobechat/builtin-tools';

import { ConnectorModel } from '@/database/models/connector';
import { PluginModel } from '@/database/models/plugin';
import type { LobeChatDatabase } from '@/database/type';

/**
 * The creator's connected extensions an Agent's model could activate on
 * demand: enabled, connected MCP and Composio connectors the Agent loads,
 * installed plugins, and LobeHub connections. In agent mode the Agent's
 * 工具与连接 page shows each as on unless turned off, so `autoGrantAgentTools`
 * reads this list to open the same set to visitors.
 *
 * Reads identifiers only, never credentials. `listLobehubSkillProviderIds`
 * asks the Market for the creator's connections; a failure there drops those
 * connections instead of failing the run.
 */
export const listShareActivatableExtensionIds = async ({
  agentId,
  db,
  listLobehubSkillProviderIds,
  userId,
  workspaceId,
}: {
  agentId: string;
  db: LobeChatDatabase;
  listLobehubSkillProviderIds?: () => Promise<string[]>;
  userId: string;
  workspaceId?: string;
}): Promise<string[]> => {
  const [connectors, plugins, lobehubSkillIds] = await Promise.all([
    new ConnectorModel(db, userId, workspaceId).queryAvailableForAgent(agentId),
    new PluginModel(db, userId, workspaceId).query(),
    listLobehubSkillProviderIds?.().catch(() => []) ?? [],
  ]);

  return [
    ...new Set([
      ...connectors
        .filter((connector) => connector.isEnabled && connector.status === 'connected')
        .map((connector) => connector.identifier),
      ...plugins.map((plugin) => plugin.identifier),
      ...lobehubSkillIds,
    ]),
  ].filter((identifier) => !isBuiltinToolIdentifier(identifier));
};

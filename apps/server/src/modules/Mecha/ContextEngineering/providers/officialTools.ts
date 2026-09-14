import { builtinTools } from '@lobechat/builtin-tools';
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import type { OfficialToolItem } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';

import { composioEnv } from '@/config/composio';
import { loadConnectedComposioIds } from '@/server/modules/AgentRuntime/adapters/composioConnectedIds';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

/**
 * The official tool catalog as an agent / group builder prompt lists it:
 * every visible builtin, then (when Composio is configured) every Composio
 * service with its connection status for the given agent. Agent-scoped
 * connections aren't in the plugin table — the connector table is unioned so
 * the builder marks them installed too.
 */
export const listOfficialTools = async (params: {
  agentId?: string;
  db: LobeChatDatabase;
  enabledPlugins: string[];
  label: string;
  userId: string;
  workspaceId?: string;
}): Promise<OfficialToolItem[]> => {
  const { agentId, db, enabledPlugins, label, userId, workspaceId } = params;
  const composioIdentifiers = new Set(COMPOSIO_APP_TYPES.map((tool) => tool.identifier));
  const officialTools: OfficialToolItem[] = [];

  for (const tool of builtinTools) {
    if (tool.hidden) continue;
    if (composioIdentifiers.has(tool.identifier)) continue;
    officialTools.push({
      description: tool.manifest?.meta?.description,
      enabled: enabledPlugins.includes(tool.identifier),
      identifier: tool.identifier,
      installed: true,
      name: tool.manifest?.meta?.title || tool.identifier,
      type: 'builtin',
    });
  }

  if (composioEnv.COMPOSIO_API_KEY) {
    try {
      const connectedComposioIds = await loadConnectedComposioIds(db, userId, workspaceId, agentId);
      for (const tool of COMPOSIO_APP_TYPES) {
        officialTools.push({
          description: `LobeHub Mcp Server: ${tool.label}`,
          enabled: enabledPlugins.includes(tool.identifier),
          identifier: tool.identifier,
          installed: connectedComposioIds.has(tool.identifier),
          name: tool.label,
          type: 'composio',
        });
      }
    } catch (composioError) {
      log('Failed to load Composio status for %s: %O', label, composioError);
    }
  }

  return officialTools;
};

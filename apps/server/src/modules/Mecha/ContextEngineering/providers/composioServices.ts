import {
  type ComposioServiceSummary,
  excludeDisabledComposioServices,
  generateComposioServicesList,
  resolveAvailableComposioServices,
} from '@lobechat/builtin-tool-creds';
import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { getDisabledPluginIds } from '@lobechat/types';

import { composioEnv } from '@/config/composio';
import { AgentModel } from '@/database/models/agent';
import { loadConnectedComposioIds } from '@/server/modules/AgentRuntime/adapters/composioConnectedIds';
import { log } from '@/server/modules/AgentRuntime/executorHelpers';

import type { ServerContextFactInput } from './types';

/**
 * `{{COMPOSIO_SERVICES_LIST}}` — connected vs. available Composio services.
 * Connected = ACTIVE connections across BOTH the legacy plugin projection AND
 * the connector table (agent-scoped connections live only in the latter).
 * Disabled services are dropped from both lists — not surfaced as "connected,
 * use directly" nor as "available to connect".
 */
export const resolveComposioServicesVariable = async ({
  agentId,
  ctx,
}: ServerContextFactInput): Promise<string> => {
  if (!ctx.serverDB || !ctx.userId || !composioEnv.COMPOSIO_API_KEY) return '';
  try {
    const connectedIds = await loadConnectedComposioIds(
      ctx.serverDB,
      ctx.userId,
      ctx.workspaceId,
      agentId,
    );
    let disabledIdSet = new Set<string>();
    if (agentId) {
      const agentConfig = await new AgentModel(
        ctx.serverDB,
        ctx.userId,
        ctx.workspaceId,
      ).getAgentConfigById(agentId);
      disabledIdSet = new Set(getDisabledPluginIds(agentConfig?.plugins ?? undefined));
    }
    const connected: ComposioServiceSummary[] = excludeDisabledComposioServices(
      COMPOSIO_APP_TYPES.filter((tool) => connectedIds.has(tool.identifier)),
      disabledIdSet,
    ).map((tool) => ({ identifier: tool.identifier, name: tool.label }));
    const available = resolveAvailableComposioServices(
      COMPOSIO_APP_TYPES,
      connectedIds,
      disabledIdSet,
    );
    log(
      'Fetched Composio services for {{COMPOSIO_SERVICES_LIST}}: connected=%d, available=%d',
      connected.length,
      available.length,
    );
    return generateComposioServicesList(connected, available);
  } catch (error) {
    log('Failed to fetch Composio services for {{COMPOSIO_SERVICES_LIST}} substitution: %O', error);
    return '';
  }
};

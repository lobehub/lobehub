import type {
  AgentConfigResolverContext,
  AgentConfigSnapshot,
  ResolvedAgentConfig,
} from '@lobechat/mecha';
import { resolveAgentConfig as resolveFromSnapshot } from '@lobechat/mecha';

import { getRuntimeCanManageAgent } from '@/helpers/agentManagementAccess';
import { getAgentStoreState } from '@/store/agent';
import {
  agentByIdSelectors,
  agentSelectors,
  chatConfigByIdSelectors,
} from '@/store/agent/selectors';
import { getChatGroupStoreState } from '@/store/agentGroup';
import { agentGroupByIdSelectors, agentGroupSelectors } from '@/store/agentGroup/selectors';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors, userProfileSelectors } from '@/store/user/selectors';
import { isDev } from '@/utils/env';

export type { AgentConfigResolverContext, ResolvedAgentConfig };

/**
 * Read everything the resolution rules need out of the client stores.
 *
 * This is the whole of what made the rules browser-specific. They now live in
 * `@lobechat/mecha` — the shared home for this layer, which the server and a
 * device reach by gathering this value from their own sources rather than
 * re-implementing the rules against them.
 */
const collectSnapshot = (ctx: AgentConfigResolverContext): AgentConfigSnapshot => {
  const agentStoreState = getAgentStoreState();
  const userState = useUserStore.getState();
  const { agentId } = ctx;

  const agent = agentByIdSelectors.getAgentById(agentId)(agentStoreState);
  const currentUserId = userProfileSelectors.userId(userState);

  // Group rows are only read in group scope or for the supervisor, but both
  // branches key off `ctx.groupId`, so one lookup up front covers them.
  const groupStoreState = ctx.groupId ? getChatGroupStoreState() : undefined;
  const group =
    ctx.groupId && groupStoreState
      ? agentGroupByIdSelectors.groupById(ctx.groupId)(groupStoreState)
      : undefined;

  return {
    agent,
    agentConfig: agentSelectors.getAgentConfigById(agentId)(agentStoreState),
    // Author-or-admin, mirroring the picker (`useAgentManagementAccess`) and the
    // server (`isResourceAuthorOrAdmin`) — an admin reads the shared row like
    // the author does, so client and gateway execution resolve the same config.
    canManage: getRuntimeCanManageAgent({
      agentId,
      agentUserId: agent?.userId,
      currentUserId,
    }),
    chatConfig: chatConfigByIdSelectors.getChatConfigById(agentId)(agentStoreState),
    group,
    groupMembers:
      group && groupStoreState
        ? agentGroupSelectors.getGroupMembers(group.id)(groupStoreState)
        : undefined,
    isDev,
    memberModeOverride: userState.workspaceUserPreference.agentModeOverrides?.[agentId],
    memberModelOverride: userState.workspaceUserPreference.agentModelOverrides?.[agentId],
    slug: agentSelectors.getAgentSlugById(agentId)(agentStoreState) ?? undefined,
    userLocale: userGeneralSettingsSelectors.currentResponseLanguage(userState),
  };
};

export const resolveAgentConfig = (ctx: AgentConfigResolverContext): ResolvedAgentConfig =>
  resolveFromSnapshot(ctx, collectSnapshot(ctx));

export const getTargetAgentId = (agentId?: string): string => {
  const agentStoreState = getAgentStoreState();
  return agentId || agentStoreState.activeAgentId || '';
};

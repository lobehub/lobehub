import type { ConversationMode } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';

import {
  loadWorkspaceMemberOverrides,
  resolveCanManage,
  type ResolveRunAgentConfigDeps,
} from './resolveRunAgentConfig';
import { preferredConversationMode } from './userTurnConversationMode';

export const agentDefaultConversationMode = async (
  deps: Pick<ResolveRunAgentConfigDeps, 'db' | 'userId' | 'workspaceId'>,
  agentId?: string,
): Promise<ConversationMode> => {
  if (!agentId) return preferredConversationMode({});
  const agent = await new AgentModel(deps.db, deps.userId, deps.workspaceId).getAgentToolPolicy(
    agentId,
  );
  if (!agent) return preferredConversationMode({});
  const workspaceId = agent.workspaceId ?? deps.workspaceId;
  const [overrides, canManage] = await Promise.all([
    loadWorkspaceMemberOverrides(deps, agentId),
    resolveCanManage(deps, agent, workspaceId, !!workspaceId && agent.visibility !== 'private'),
  ]);
  return preferredConversationMode({
    canManage,
    chatConfig: agent.chatConfig,
    memberMode: overrides.mode,
  });
};

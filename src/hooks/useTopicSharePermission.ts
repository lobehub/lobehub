import { canPublishAgentTopicLink } from '@lobechat/types';
import { useTranslation } from 'react-i18next';

import { type Permission, usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

/**
 * Whether the active user may publish a share link for a topic held by
 * `agentId`, and why not when they may not.
 *
 * Two gates in order:
 *
 * 1. the workspace role gate every content write goes through
 *    (`edit_own_content`), and
 * 2. the agent's own `topicSharePolicy`, which an author sets on the Permission
 *    page to keep members from publishing that agent's conversations. The
 *    policy is per-agent, not per-topic: under `member` a member may publish
 *    any of the agent's topics they can open, so topic ownership plays no part
 *    here.
 *
 * This only mirrors the server — `assertCanManageTopicShare` in the topic
 * router is the enforcing copy. Mirroring it is still worth it: without the
 * policy here a restricted member would get a share popover that looks armed
 * and then fails on click, instead of a disabled control that says who to ask.
 *
 * An unloaded agent reads as unrestricted (the row simply isn't in the store
 * yet); the server refuses the write either way, so the worst case is a control
 * that enables a beat early rather than one that lies about being blocked.
 */
export const useTopicSharePermission = (agentId?: string): Permission => {
  const { t } = useTranslation('setting');
  const role = usePermission('edit_own_content');
  // Workspace owners bypass every per-agent restriction — the same bucket the
  // server grants through the `topic:update:all` scope.
  const { allowed: isWorkspaceOwner } = usePermission('edit_others_content');
  const agent = useAgentStore(agentByIdSelectors.getAgentById(agentId ?? ''));
  const userId = useUserStore(userProfileSelectors.userId);

  if (!role.allowed) return role;

  const canShare = canPublishAgentTopicLink(
    agent && {
      agencyConfig: agent.agencyConfig,
      userId: agent.userId,
      workspaceId: agent.workspaceId,
    },
    { isWorkspaceOwner, userId },
  );

  if (canShare) return { allowed: true, reason: undefined };

  return { allowed: false, reason: t('workspace.permission.topicShareRestricted') };
};

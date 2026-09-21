import { DEFAULT_AVATAR } from '@lobechat/const';
import type { NotificationMetadata } from '@lobechat/types';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';

import { getNotificationAgentId } from './getNotificationAgentId';

interface NotificationAgentDisplayMeta {
  avatar: string;
  backgroundColor?: string;
  title?: string;
}

/**
 * Resolve the agent to show on a notification row. Live store data wins (the
 * agent may have been re-skinned since the row was written); the send-time
 * `metadata.agent` snapshot covers agents the client never loaded, e.g.
 * scheduled-task agents whose actionUrl (`/task/:id`) carries no agent segment.
 */
export const useNotificationAgentMeta = (
  actionUrl: string | null | undefined,
  metadata: NotificationMetadata | null | undefined,
): NotificationAgentDisplayMeta | undefined => {
  const snapshot = metadata?.agent;
  const agentId = snapshot?.id ?? getNotificationAgentId(actionUrl);
  const liveAgent = useAgentDisplayMeta(agentId, { fallbackToDefault: false });

  if (liveAgent) return liveAgent;
  if (!snapshot) return undefined;

  return {
    avatar: snapshot.avatar || DEFAULT_AVATAR,
    backgroundColor: snapshot.backgroundColor,
    title: snapshot.name,
  };
};

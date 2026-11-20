import type { NotificationMetadata } from '@lobechat/types';

import { useAgentDisplayMeta } from '@/features/AgentTasks/shared/useAgentDisplayMeta';

import { getNotificationAgentId } from './getNotificationAgentId';

interface NotificationAgentDisplayMeta {
  /** Empty when the agent has no avatar of its own: the row draws the generated one. */
  avatar?: string;
  backgroundColor?: string;
  /** Seeds the generated avatar. */
  id: string;
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

  if (liveAgent) return { ...liveAgent, id: agentId! };
  if (!snapshot) return undefined;

  return {
    avatar: snapshot.avatar || undefined,
    backgroundColor: snapshot.backgroundColor,
    id: snapshot.id,
    title: snapshot.name,
  };
};

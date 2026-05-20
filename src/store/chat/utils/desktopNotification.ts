import {
  GROUP_CHAT_URL,
  isDesktop,
  SESSION_CHAT_TOPIC_URL,
  SESSION_CHAT_URL,
} from '@lobechat/const';
import type { ConversationContext } from '@lobechat/types';
import { t } from 'i18next';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import type { ChatStore } from '@/store/chat/store';

import { topicMapKey } from './topicMapKey';

export interface DesktopNotificationContext {
  agentId?: ConversationContext['agentId'];
  groupId?: ConversationContext['groupId'];
  topicId?: ConversationContext['topicId'];
}

/**
 * Resolve the SPA path that should be opened when the user clicks a desktop
 * notification, based on the conversation context. Group chats land on the
 * group root (topic is selected from store), 1:1 chats deep-link to the
 * specific topic.
 */
export const resolveNotificationNavigatePath = (
  context: DesktopNotificationContext,
): string | undefined => {
  if (context.groupId) return GROUP_CHAT_URL(context.groupId);
  if (context.agentId && context.topicId) {
    return SESSION_CHAT_TOPIC_URL(context.agentId, context.topicId);
  }
  if (context.agentId) return SESSION_CHAT_URL(context.agentId);
  return undefined;
};

const resolveNotificationTitle = (
  get: () => ChatStore,
  context: DesktopNotificationContext,
): string => {
  const title = t('desktopNotification.humanApprovalRequired.title', { ns: 'chat' });

  if (context.topicId && context.agentId) {
    const key = topicMapKey({ agentId: context.agentId, groupId: context.groupId });
    const topicData = get().topicDataMap[key];
    const topic = topicData?.items?.find((item) => item.id === context.topicId);

    if (topic?.title) return topic.title;
  }

  if (context.agentId) {
    const agentMeta = agentSelectors.getAgentMetaById(context.agentId)(getAgentStoreState());

    if (agentMeta?.title) return agentMeta.title;
  }

  return title;
};

export const notifyDesktopHumanApprovalRequired = async (
  get: () => ChatStore,
  context: DesktopNotificationContext,
): Promise<void> => {
  if (!isDesktop) return;

  try {
    const { desktopNotificationService } = await import('@/services/electron/desktopNotification');
    const title = resolveNotificationTitle(get, context);

    const navigatePath = resolveNotificationNavigatePath(context);

    await Promise.allSettled([
      desktopNotificationService.setBadgeCount(1),
      desktopNotificationService.showNotification({
        body: t('desktopNotification.humanApprovalRequired.body', { ns: 'chat' }),
        force: true,
        navigate: navigatePath ? { path: navigatePath } : undefined,
        requestAttention: true,
        title,
      }),
    ]);
  } catch (error) {
    console.error('Human approval desktop notification failed:', error);
  }
};

import { isDesktop } from '@lobechat/const';
import type { ConversationContext } from '@lobechat/types';
import { t } from 'i18next';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import type { ChatStore } from '@/store/chat/store';

import { topicMapKey } from './topicMapKey';

interface DesktopNotificationContext {
  agentId?: ConversationContext['agentId'];
  groupId?: ConversationContext['groupId'];
  topicId?: ConversationContext['topicId'];
}

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

    await Promise.allSettled([
      desktopNotificationService.setBadgeCount(1),
      desktopNotificationService.showNotification({
        body: t('desktopNotification.humanApprovalRequired.body', { ns: 'chat' }),
        force: true,
        requestAttention: true,
        title,
      }),
    ]);
  } catch (error) {
    console.error('Human approval desktop notification failed:', error);
  }
};

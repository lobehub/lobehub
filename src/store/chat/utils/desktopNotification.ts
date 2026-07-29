import {
  AGENT_CHAT_TOPIC_URL,
  AGENT_CHAT_URL,
  GROUP_CHAT_TOPIC_URL,
  GROUP_CHAT_URL,
  isDesktop,
} from '@lobechat/const';
import type { ConversationContext } from '@lobechat/types';
import { t } from 'i18next';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import type { ChatStore } from '@/store/chat/store';
import { markdownToTxt } from '@/utils/markdownToTxt';

import { topicMapKey } from './topicMapKey';

export interface DesktopNotificationContext {
  agentId?: ConversationContext['agentId'];
  groupId?: ConversationContext['groupId'];
  topicId?: ConversationContext['topicId'];
  workspaceSlug?: ConversationContext['workspaceSlug'];
}

/** Cap the notification body so a long reply doesn't overflow the OS banner. */
const NOTIFICATION_BODY_MAX_LENGTH = 256;

const applyWorkspaceSlug = (path: string, workspaceSlug?: string): string =>
  workspaceSlug ? `/${workspaceSlug}${path}` : path;

/**
 * Resolve the SPA path that should be opened when the user clicks a desktop
 * notification, based on the conversation context. Topic-aware contexts
 * deep-link to the specific topic so clicking from another tab/topic still
 * lands on the completed run.
 */
export const resolveNotificationNavigatePath = (
  context: DesktopNotificationContext,
): string | undefined => {
  if (context.groupId && context.topicId)
    return applyWorkspaceSlug(
      GROUP_CHAT_TOPIC_URL(context.groupId, context.topicId),
      context.workspaceSlug,
    );
  if (context.groupId)
    return applyWorkspaceSlug(GROUP_CHAT_URL(context.groupId), context.workspaceSlug);
  if (context.agentId && context.topicId) {
    return applyWorkspaceSlug(
      AGENT_CHAT_TOPIC_URL(context.agentId, context.topicId),
      context.workspaceSlug,
    );
  }
  if (context.agentId)
    return applyWorkspaceSlug(AGENT_CHAT_URL(context.agentId), context.workspaceSlug);
  return undefined;
};

export const resolveNotificationNavigate = (context: DesktopNotificationContext) => {
  const path = resolveNotificationNavigatePath(context);

  return path ? { escape: true, path } : undefined;
};

/**
 * Resolve the notification title from the conversation context. Prefers the
 * topic title, then the agent name, and finally the caller-provided fallback.
 */
export const resolveNotificationTitle = (
  get: () => ChatStore,
  context: DesktopNotificationContext,
  fallbackTitle: string,
): string => {
  if (context.topicId && context.agentId) {
    const key = topicMapKey({ agentId: context.agentId, groupId: context.groupId });
    const topicData = get().topicDataMap?.[key];
    const topic = topicData?.items?.find((item) => item.id === context.topicId);

    if (topic?.title) return topic.title;
  }

  if (context.agentId) {
    const agentMeta = agentSelectors.getAgentMetaById(context.agentId)(getAgentStoreState());

    if (agentMeta?.title) return agentMeta.title;
  }

  return fallbackTitle;
};

/** Convert the assistant's markdown reply to a length-capped plain-text body. */
export const buildNotificationBody = (
  content: string | undefined,
  fallbackBody: string,
): string => {
  const text = content ? markdownToTxt(content).trim() : '';
  if (!text) return fallbackBody;
  return text.length > NOTIFICATION_BODY_MAX_LENGTH
    ? `${text.slice(0, NOTIFICATION_BODY_MAX_LENGTH)}…`
    : text;
};

export const notifyDesktopHumanApprovalRequired = async (
  get: () => ChatStore,
  context: DesktopNotificationContext,
): Promise<void> => {
  if (!isDesktop) return;

  try {
    const { desktopNotificationService } = await import('@/services/electron/desktopNotification');
    const title = resolveNotificationTitle(
      get,
      context,
      t('desktopNotification.humanApprovalRequired.title', { ns: 'chat' }),
    );

    const navigate = resolveNotificationNavigate(context);

    await Promise.allSettled([
      desktopNotificationService.setBadgeCount(1),
      desktopNotificationService.showNotification({
        body: t('desktopNotification.humanApprovalRequired.body', { ns: 'chat' }),
        force: true,
        navigate,
        requestAttention: true,
        title,
      }),
    ]);
  } catch (error) {
    console.error('Human approval desktop notification failed:', error);
  }
};

export interface AgentCompletedNotificationOptions {
  /** Whether to also bump the dock/taskbar badge to 1 (background runs). */
  badge?: boolean;
  /** The assistant's final reply (markdown); rendered as the notification body. */
  content?: string;
  context: DesktopNotificationContext;
}

/**
 * Unified "agent run finished" desktop notification — the single injection point
 * every run path (client / gateway / hetero / group orchestration) calls so each
 * completion notification stays consistent:
 *
 * - **title** = topic title → agent name → generic fallback,
 * - **body** = the actual reply (markdown stripped + length-capped),
 * - **click** = deep-links to the agent/topic (or group) conversation.
 *
 * Callers pass only their conversation context + the assistant reply; they never
 * assemble the title / body / navigate themselves.
 */
export const notifyDesktopAgentCompleted = async (
  get: () => ChatStore,
  { context, content, badge }: AgentCompletedNotificationOptions,
): Promise<void> => {
  if (!isDesktop) return;

  try {
    const { desktopNotificationService } = await import('@/services/electron/desktopNotification');
    const fallback = t('notification.finishChatGeneration', { ns: 'electron' });
    const navigate = resolveNotificationNavigate(context);

    const tasks: Promise<unknown>[] = [
      desktopNotificationService.showNotification({
        body: buildNotificationBody(content, fallback),
        navigate,
        title: resolveNotificationTitle(get, context, fallback),
      }),
    ];
    if (badge) tasks.push(desktopNotificationService.setBadgeCount(1));

    await Promise.allSettled(tasks);
  } catch (error) {
    console.error('Agent completion desktop notification failed:', error);
  }
};

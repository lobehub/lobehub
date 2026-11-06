import { type ChatStoreState } from '@/store/chat';

import { type PortalViewData } from '../initialState';
import { PortalViewType } from '../initialState';

// Helper to get current view
const getCurrentView = (s: ChatStoreState): PortalViewData | null => {
  const { portalStack } = s;
  return portalStack.at(-1) ?? null;
};

// Check if current view is Thread
const showThread = (s: ChatStoreState) => {
  const view = getCurrentView(s);
  if (view?.type === PortalViewType.Thread) {
    return true;
  }
  // Also check legacy threadStartMessageId for backward compatibility during transition
  return !!s.threadStartMessageId;
};

const newThreadMode = (s: ChatStoreState) => s.newThreadMode;

// Get current thread data from stack
const currentThreadView = (s: ChatStoreState) => {
  const view = getCurrentView(s);
  if (view?.type === PortalViewType.Thread) {
    return view;
  }
  return null;
};

// Get thread ID - from stack or legacy field
const portalThreadId = (s: ChatStoreState): string | undefined => {
  const threadView = currentThreadView(s);
  return threadView?.threadId ?? s.portalThreadId;
};

// Get start message ID - from stack or legacy field
const threadStartMessageId = (s: ChatStoreState): string | undefined => {
  const threadView = currentThreadView(s);
  return threadView?.startMessageId ?? s.threadStartMessageId ?? undefined;
};

const portalCurrentThread = (s: ChatStoreState) => {
  const threadId = portalThreadId(s);
  if (!threadId || !s.activeTopicId) return;

  return (s.threadMaps[s.activeTopicId] || []).find((t) => t.id === threadId);
};

/**
 * Whether the Portal's thread can stay open once `topicId` becomes the active
 * topic. It can't without a topic, nor when another topic's loaded list holds
 * it. A thread no loaded list knows yet (a deep link still fetching) is kept.
 */
const isPortalThreadKeptOnTopic =
  (topicId?: string | null) =>
  (s: ChatStoreState): boolean => {
    const threadId = portalThreadId(s);
    if (!threadId || !topicId) return false;

    return !Object.entries(s.threadMaps).some(
      ([ownerTopicId, threads]) =>
        ownerTopicId !== topicId && threads?.some((thread) => thread.id === threadId),
    );
  };

export const portalThreadSelectors = {
  currentThreadView,
  isPortalThreadKeptOnTopic,
  newThreadMode,
  portalCurrentThread,
  portalThreadId,
  showThread,
  threadStartMessageId,
};

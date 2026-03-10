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

export const portalThreadSelectors = {
  currentThreadView,
  newThreadMode,
  portalCurrentThread,
  portalThreadId,
  showThread,
  threadStartMessageId,
};

import type { ConversationContext } from '@lobechat/types';

import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/** What the main composer's draft receiver publishes on the composer draft bus. */
export interface MainComposerRegistration {
  attached: boolean;
  contextKey?: string;
}

/**
 * Whether a conversation is the agent's main chat composer, the only host where "New
 * conversation" can open a new topic and carry the draft there.
 *
 * Page and task copilots mirror the active agent and topic into the chat store, so matching
 * those ids is not enough: the main composer's receiver must have registered this conversation's
 * key, and the conversation must be neither a group, a thread nor a non-main scope.
 */
export const isMainComposer = (
  context: ConversationContext,
  registration: MainComposerRegistration,
): boolean => {
  if (context.groupId || context.threadId) return false;
  if (context.scope && context.scope !== 'main') return false;

  return registration.attached && registration.contextKey === messageMapKey(context);
};

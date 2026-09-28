import type {
  ChatThreadType,
  ConversationContext,
  CreateThreadWithMessageParams,
} from '@lobechat/types';

/**
 * Read a "start a new subtopic" intent off a conversation context.
 *
 * The composer stages a subtopic entirely client-side — `scope: 'thread'` plus
 * `isNew`, with no thread row yet — and the server materialises it as part of
 * the send. Both transports need the same intent (`sendMessageInServer.newThread`
 * for the client runtime, `execAgentTask.appContext.newThread` for the gateway),
 * so they read it from here rather than each deriving it: when only one of them
 * did, gateway sends silently persisted the turn onto the topic's main spine and
 * the subtopic collapsed back into the main conversation.
 *
 * Returns undefined for every other context, including a follow-up inside a
 * thread that already exists (`threadId` set, `isNew` false).
 */
export const resolveNewThreadIntent = (
  context: ConversationContext,
): CreateThreadWithMessageParams | undefined => {
  const { isNew, scope, sourceMessageId, threadType } = context;

  // `sourceMessageId` is the branch point and `threadType` decides whether the
  // parent context carries over — a staged thread missing either is not
  // actionable, so treat it as a plain send rather than guessing.
  if (!isNew || scope !== 'thread' || !sourceMessageId || !threadType) return undefined;

  return { sourceMessageId, type: threadType as ChatThreadType };
};

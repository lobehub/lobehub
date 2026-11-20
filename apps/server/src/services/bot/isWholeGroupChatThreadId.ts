/**
 * Is this conversation the platform's **whole group chat**?
 *
 * A Feishu/Lark group main is mention-only from its very first
 * message, so the "Multiple people are talking in this thread now…" notice
 * explains nothing there — it just spams the room (see the 中信 Agent Sentry
 * report). Suppress it for those conversations.
 *
 * The predicate reads the chat type the inbound adapter encodes into the
 * thread id (`encodeLarkThreadId` → `lark:group:oc_xxx` / `lark:p2p:oc_xxx`),
 * i.e. the shape production actually emits.
 *
 * It is deliberately NOT a thread-vs-topic check: Feishu conversations are
 * keyed by `chat_id` alone today (`packages/chat-adapter-feishu/src/adapter.ts`),
 * and outbound sends only support `receive_id_type=chat_id`
 * (`api.sendMessage`), so a topic inside a group currently looks exactly like
 * the group main and is suppressed with it. Giving topics their own notice
 * needs the adapter to carry topic identity both ways — tracked separately.
 */
export const isWholeGroupChatThreadId = (threadId: string): boolean => {
  const [platform, chatType] = threadId.split(':');
  // Only Feishu/Lark group chats are affected; every other platform keeps its
  // existing announcement behaviour.
  if (platform !== 'feishu' && platform !== 'lark') return false;
  return chatType === 'group';
};

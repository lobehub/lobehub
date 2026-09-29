/**
 * Feishu/Lark group mains are already mention-only. Nested topic/thread
 * ids have a 4th segment and still receive the notice. LOBE-14475.
 */
export const isWholeGroupChatThreadId = (threadId: string): boolean => {
  const parts = threadId.split(':');
  const platform = parts[0];
  if (platform !== 'feishu' && platform !== 'lark') return false;
  return parts.length < 4;
};

/** Chat SDK thread ids for Linq are `linq:<chatId>`; the chat id is Linq's own. */
const PREFIX = 'linq:';

export const encodeLinqThreadId = (chatId: string): string => `${PREFIX}${chatId}`;

export const decodeLinqThreadId = (threadId: string): string =>
  threadId.startsWith(PREFIX) ? threadId.slice(PREFIX.length) : threadId;

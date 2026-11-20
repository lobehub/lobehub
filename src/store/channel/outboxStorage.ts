import type { ChannelOutgoingMessage } from './outbox';

export const CHANNEL_OUTBOX_STORAGE_KEY = 'lobehub:channel-outbox:v1';

const MAX_MESSAGES = 100;

/** What survives a reload: the message itself, not where its last send attempt got to. */
type StoredMessage = Omit<ChannelOutgoingMessage, 'createdAt' | 'sent' | 'status'> & {
  createdAt: string;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isStoredMessage = (value: unknown): value is StoredMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as StoredMessage;
  return (
    typeof message.requestKey === 'string' &&
    typeof message.scope === 'string' &&
    typeof message.channelId === 'string' &&
    typeof message.content === 'string' &&
    typeof message.createdAt === 'string' &&
    (message.threadId === null || typeof message.threadId === 'string') &&
    isStringArray(message.fileIds) &&
    isStringArray(message.mentions) &&
    Array.isArray(message.attachments)
  );
};

const read = (): StoredMessage[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(CHANNEL_OUTBOX_STORAGE_KEY) || '[]',
    );
    return Array.isArray(parsed) ? parsed.filter(isStoredMessage) : [];
  } catch {
    return [];
  }
};

const write = (messages: StoredMessage[]) => {
  if (typeof window === 'undefined') return;
  try {
    if (messages.length)
      window.localStorage.setItem(
        CHANNEL_OUTBOX_STORAGE_KEY,
        JSON.stringify(messages.slice(-MAX_MESSAGES)),
      );
    else window.localStorage.removeItem(CHANNEL_OUTBOX_STORAGE_KEY);
  } catch {
    // A blocked or full store keeps the message for this session only.
  }
};

/**
 * Keeps messages that have not reached the server across reloads, like a composer draft
 * would have. Shared by the tabs of a browser; each identity scope reads only its own.
 */
export const channelOutboxStorage = {
  /** Removes a message the server confirmed, or one the user deleted. */
  forget: (message: Pick<ChannelOutgoingMessage, 'requestKey'>) => {
    const messages = read();
    const remaining = messages.filter((entry) => entry.requestKey !== message.requestKey);
    if (remaining.length !== messages.length) write(remaining);
  },
  /**
   * The scope's unsent messages, oldest first. Whether an interrupted send reached the server
   * is unknown, so every one comes back failed; a retry reuses its request key.
   */
  load: (scope: string): ChannelOutgoingMessage[] =>
    read()
      .filter((entry) => entry.scope === scope)
      .map((entry) => ({
        ...entry,
        createdAt: new Date(entry.createdAt),
        status: 'failed' as const,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  save: ({ createdAt, sent: _, status: __, ...message }: ChannelOutgoingMessage) =>
    write([
      ...read().filter((entry) => entry.requestKey !== message.requestKey),
      { ...message, createdAt: createdAt.toISOString() },
    ]),
};

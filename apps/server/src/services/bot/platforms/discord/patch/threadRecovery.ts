import type { RESTGetAPIChannelMessageResult } from 'discord-api-types/v10';

const DISCORD_THREAD_ALREADY_CREATED_CODE = 160004;
const PATCHED_FLAG = Symbol.for('lobe.discord.thread-recovery.patched');

interface RecoverableDiscordThreadAdapter {
  createDiscordThread: (channelId: string, messageId: string) => Promise<{ id: string }>;
  discordFetch: (path: string, method: string, body?: Record<string, unknown>) => Promise<Response>;
  logger?: {
    debug?: (message: string, metadata?: Record<string, unknown>) => void;
    error?: (message: string, metadata?: Record<string, unknown>) => void;
    warn?: (message: string, metadata?: Record<string, unknown>) => void;
  };
  [PATCHED_FLAG]?: boolean;
}

const isRecoverableDiscordThreadAdapter = (
  adapter: unknown,
): adapter is RecoverableDiscordThreadAdapter => {
  if (!adapter || typeof adapter !== 'object') return false;

  return (
    typeof (adapter as RecoverableDiscordThreadAdapter).createDiscordThread === 'function' &&
    typeof (adapter as RecoverableDiscordThreadAdapter).discordFetch === 'function'
  );
};

const getDiscordErrorCode = (error: unknown): number | undefined => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const match = rawMessage.match(/"code"\s*:\s*(\d+)/);

  if (!match) return;

  return Number(match[1]);
};

const getExistingThread = async (
  adapter: RecoverableDiscordThreadAdapter,
  channelId: string,
  messageId: string,
): Promise<{ id: string } | undefined> => {
  try {
    const response = await adapter.discordFetch(
      `/channels/${channelId}/messages/${messageId}`,
      'GET',
    );
    const message = (await response.json()) as RESTGetAPIChannelMessageResult;
    const threadId = message.thread?.id;

    if (!threadId) {
      adapter.logger?.warn?.('Discord thread recovery could not find thread on starter message', {
        channelId,
        messageId,
      });
      return;
    }

    adapter.logger?.debug?.('Recovered existing Discord thread for starter message', {
      channelId,
      messageId,
      threadId,
    });

    return { id: threadId };
  } catch (recoveryError) {
    adapter.logger?.error?.('Failed to recover existing Discord thread', {
      channelId,
      error: String(recoveryError),
      messageId,
    });
    return;
  }
};

export const patchDiscordThreadRecovery = (chatBot: unknown) => {
  const adapter = (chatBot as { adapters?: Map<string, unknown> } | undefined)?.adapters?.get?.(
    'discord',
  );

  if (!isRecoverableDiscordThreadAdapter(adapter) || adapter[PATCHED_FLAG]) return;

  const originalCreateDiscordThread = adapter.createDiscordThread.bind(adapter);

  adapter.createDiscordThread = async (channelId, messageId) => {
    try {
      return await originalCreateDiscordThread(channelId, messageId);
    } catch (error) {
      if (getDiscordErrorCode(error) !== DISCORD_THREAD_ALREADY_CREATED_CODE) {
        throw error;
      }

      const existingThread = await getExistingThread(adapter, channelId, messageId);

      if (existingThread) return existingThread;

      throw error;
    }
  };

  adapter[PATCHED_FLAG] = true;
};

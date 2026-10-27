import type { Chat } from 'chat';
import debug from 'debug';

const log = debug('bot-platform:discord:mention-threads');

const PATCHED_FLAG = Symbol.for('lobe.discord.mention-threads.patched');

interface MentionThreadAdapter {
  createDiscordThread: (channelId: string, messageId: string) => Promise<{ id?: string }>;
  [PATCHED_FLAG]?: boolean;
}

const isMentionThreadAdapter = (adapter: unknown): adapter is MentionThreadAdapter =>
  !!adapter &&
  typeof adapter === 'object' &&
  typeof (adapter as MentionThreadAdapter).createDiscordThread === 'function';

/**
 * Lets the router decide where an @-mention is answered.
 *
 * `@chat-adapter/discord` opens a reply thread for every @-mention in a channel before any handler
 * runs (`createDiscordThread` in `handleForwardedMessage` / `handleGatewayMessage`), so the bot
 * could never answer in the channel itself. When `deferMentionThread` says yes, the patched method
 * opens nothing and returns no id: the adapter then dispatches the message with the channel's own
 * thread id, and the router opens a thread later only if the bot chooses one.
 *
 * Fails open to the adapter's behaviour: a predicate that throws keeps the auto-created thread.
 */
export const patchDiscordMentionThreads = (
  chatBot: Chat<any>,
  deferMentionThread: () => Promise<boolean>,
) => {
  const adapter = (chatBot as any).adapters?.get?.('discord');

  if (!isMentionThreadAdapter(adapter) || adapter[PATCHED_FLAG]) return;

  const originalCreateDiscordThread = adapter.createDiscordThread.bind(adapter);

  adapter.createDiscordThread = async (channelId, messageId) => {
    let defer = false;
    try {
      defer = await deferMentionThread();
    } catch (error) {
      log('deferMentionThread failed, keeping the auto-created thread: %O', error);
    }
    if (!defer) return originalCreateDiscordThread(channelId, messageId);

    log('kept mention %s in channel %s for the router to place', messageId, channelId);

    return { id: undefined };
  };

  adapter[PATCHED_FLAG] = true;
};

import type { Chat, Message } from 'chat';
import debug from 'debug';

const log = debug('lobe-server:bot:message-router');

// single-user thread relaxation. A subscribed channel thread
// with only one human follower is effectively a private 1:1 with the
// bot, so we drop the @mention requirement for follow-ups. Once a
// second human posts the bot is no longer addressed by default; bot-wake
// decides whether it still speaks up, so nothing is announced.
const PARTICIPANTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const participantsKey = (threadId: string): string => `messenger:thread-humans:${threadId}`;

/**
 * Track the distinct participants (humans and other bots) who have spoken in a subscribed thread, stored in
 * the bot's chat-sdk state. Returns `trackThreadParticipants`, which folds a
 * debounced batch into one count.
 */
export const createParticipantTracker = (bot: Chat<any>) => {
  const trackThreadParticipant = async (
    thread: { id: string; isDM?: boolean },
    message: Message,
  ): Promise<{ count: number; isNewParticipant: boolean }> => {
    if (thread.isDM) return { count: 0, isNewParticipant: false };
    const senderId = message.author?.userId;
    // Other bots (another Agent) are participants too: once one joins, the
    // thread is no longer a private 1:1. Only this bot's own messages are
    // excluded.
    const isParticipant = !!senderId && (message.author as { isMe?: boolean })?.isMe !== true;
    if (!isParticipant) return { count: 0, isNewParticipant: false };

    const stateAdapter = bot.getState();
    const key = participantsKey(thread.id);
    let participants: string[] = [];
    try {
      participants = (await stateAdapter.getList<string>(key)) ?? [];
    } catch (error) {
      log('trackThreadParticipant: getList failed: %O', error);
    }
    if (participants.includes(senderId)) {
      return { count: participants.length, isNewParticipant: false };
    }
    try {
      await stateAdapter.appendToList(key, senderId, {
        maxLength: 50,
        ttlMs: PARTICIPANTS_TTL_MS,
      });
    } catch (error) {
      log('trackThreadParticipant: appendToList failed: %O', error);
    }
    return { count: participants.length + 1, isNewParticipant: true };
  };

  const trackThreadParticipants = async (
    thread: { id: string; isDM?: boolean },
    messages: readonly Message[],
  ): Promise<{ count: number; isNewParticipant: boolean }> => {
    let count = 0;
    let isNewParticipant = false;
    for (const candidate of messages) {
      const tracked = await trackThreadParticipant(thread, candidate);
      count = Math.max(count, tracked.count);
      isNewParticipant ||= tracked.isNewParticipant;
    }
    return { count, isNewParticipant };
  };

  return trackThreadParticipants;
};

/**
 * Whether an unaddressed message in a subscribed thread may be answered
 * without an @mention.
 *
 * Recorded speakers are checked first: they are stored before this decision,
 * so a second participant switches the thread to mention-only immediately,
 * even while a cached platform "solo" verdict has not expired yet. The
 * platform membership lookup can only narrow a single-speaker thread further
 * (e.g. silent members); an unprovable chat fails closed.
 */
export const isSoloThreadConversation = async (
  participantCount: number,
  lookupMembership?: () => Promise<boolean>,
): Promise<boolean> => {
  if (participantCount > 1) return false;
  if (!lookupMembership) return true;
  try {
    return await lookupMembership();
  } catch (error) {
    log('isSoloThreadConversation: membership lookup failed: %O', error);
    return false;
  }
};

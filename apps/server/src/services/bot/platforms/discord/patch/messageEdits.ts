import type { Chat, Message } from 'chat';
import debug from 'debug';

import { redisService } from '@/server/services/redis';
import { EDIT_WAKE_WINDOW_SECONDS } from '@/server/services/redis/botWake';

const log = debug('bot-platform:discord:message-edits');

const MESSAGE_CREATE_EVENT = 'GATEWAY_MESSAGE_CREATE';
const MESSAGE_UPDATE_EVENT = 'GATEWAY_MESSAGE_UPDATE';
const PATCHED_FLAG = Symbol.for('lobe.discord.message-edits.patched');

/** The fields of a forwarded `MESSAGE_CREATE` / `MESSAGE_UPDATE` payload this patch reads. */
interface GatewayMessage {
  author?: { bot?: boolean; id?: string };
  /** Set only by a real edit; an embed unfurl updates the message without it. */
  edited_timestamp?: string | null;
  guild_id?: string;
  id?: string;
  mentions?: { id?: string }[];
  timestamp?: string;
}

interface ForwardedGatewayEvent {
  data?: unknown;
  type?: string;
}

interface MessageEditAdapter {
  applicationId: string;
  handleForwardedGatewayEvent: (
    event: ForwardedGatewayEvent,
    options?: unknown,
  ) => Promise<Response>;
  handleForwardedMessage: (data: unknown, options?: unknown) => Promise<void>;
  name: string;
  [PATCHED_FLAG]?: boolean;
}

export interface MessageEditDeps {
  /** Claims the one wake an edit may start on a message; see `redisService.botWake`. */
  claimEditWake: (applicationId: string, messageId: string) => Promise<boolean>;
  /** Whether the wake pipeline already decided to wake the bot on the message (parked or not). */
  hasInitiation: (applicationId: string, messageId: string) => Promise<boolean>;
  /** Remembers that a message engaged the bot when it was sent. */
  markEngaged: (applicationId: string, messageIds: readonly string[]) => Promise<void>;
  now?: () => number;
}

const okResponse = () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

const isMessageEditAdapter = (adapter: unknown): adapter is MessageEditAdapter =>
  !!adapter &&
  typeof adapter === 'object' &&
  typeof (adapter as MessageEditAdapter).applicationId === 'string' &&
  typeof (adapter as MessageEditAdapter).handleForwardedGatewayEvent === 'function' &&
  typeof (adapter as MessageEditAdapter).handleForwardedMessage === 'function';

/**
 * Only a real @-mention of this bot counts. The adapter also treats role mentions, `@everyone` and
 * allowlisted channels as mentions, but LobeHub configures none of them.
 */
const mentionsBot = (message: GatewayMessage, applicationId: string) =>
  !!message.mentions?.some((user) => user.id === applicationId);

const redisDeps: MessageEditDeps = {
  claimEditWake: (applicationId, messageId) =>
    redisService.botWake.claimEditWake(applicationId, messageId),
  hasInitiation: async (applicationId, messageId) =>
    !!(await redisService.botWake.readInitiation(applicationId, messageId)),
  markEngaged: (applicationId, messageIds) =>
    redisService.botWake.markEditWakeEngaged(applicationId, messageIds),
};

/**
 * Wakes the bot when someone edits a message to @-mention it ("…这两个feature吧" → "…吧 @Nasa").
 *
 * The Gateway listener forwards every raw event, but `@chat-adapter/discord` only handles
 * `MESSAGE_CREATE`, so an edit used to reach the webhook and stop at "no handler": the wake
 * pipeline only ever judged the text as first sent. The patched handler hands an edit that newly
 * @-mentions the bot to the adapter's own `MESSAGE_CREATE` path, so it is routed exactly like a
 * fresh @-mention, with `metadata.edited` set.
 *
 * An edit wakes the bot at most once per message, and never when the message already engaged it:
 * it @-mentioned the bot when sent, the bot already replied to it, or the wake pipeline already
 * decided to wake on it. Fixing a typo in a message the bot answered does not answer it again.
 * Only guild messages within {@link EDIT_WAKE_WINDOW_SECONDS} of being sent qualify: a DM wakes
 * the bot on every message anyway, and an old message edited days later is not a new question.
 */
export const patchDiscordMessageEdits = (chatBot: Chat<any>, deps: MessageEditDeps = redisDeps) => {
  const adapter = (chatBot as any).adapters?.get?.('discord');

  if (!isMessageEditAdapter(adapter) || adapter[PATCHED_FLAG]) return;

  const now = deps.now ?? Date.now;
  const originalHandleForwardedGatewayEvent = adapter.handleForwardedGatewayEvent.bind(adapter);
  const { applicationId } = adapter;

  const rememberMention = async (message: GatewayMessage) => {
    if (!message.id || !mentionsBot(message, applicationId)) return;

    try {
      await deps.markEngaged(applicationId, [message.id]);
    } catch (error) {
      log('markEngaged failed for %s: %O', message.id, error);
    }
  };

  /** Whether this edit is the first to @-mention the bot on a message that never engaged it. */
  const claimsWake = async (message: GatewayMessage): Promise<boolean> => {
    if (!message.id || !message.edited_timestamp || !message.guild_id) return false;
    if (!message.author?.id || message.author.bot) return false;
    if (!mentionsBot(message, applicationId)) return false;

    const sentAt = Date.parse(message.timestamp ?? '');
    if (!Number.isFinite(sentAt) || now() - sentAt > EDIT_WAKE_WINDOW_SECONDS * 1000) return false;

    try {
      if (await deps.hasInitiation(applicationId, message.id)) return false;

      return await deps.claimEditWake(applicationId, message.id);
    } catch (error) {
      log('edit-wake claim failed for %s: %O', message.id, error);

      return false;
    }
  };

  adapter.handleForwardedGatewayEvent = async (event, options) => {
    if (event?.type === MESSAGE_CREATE_EVENT) {
      await rememberMention((event.data ?? {}) as GatewayMessage);

      return originalHandleForwardedGatewayEvent(event, options);
    }

    if (event?.type !== MESSAGE_UPDATE_EVENT) {
      return originalHandleForwardedGatewayEvent(event, options);
    }

    const message = (event.data ?? {}) as GatewayMessage;
    if (!(await claimsWake(message))) return okResponse();

    log('edit of %s @-mentions the bot, routing it as a new mention', message.id);

    // The Chat SDK drops a message id it saw in the last 10 minutes; the original send is one.
    try {
      await chatBot.getState().delete(`dedupe:${adapter.name}:${message.id}`);
    } catch (error) {
      log('clearing the dedupe key of %s failed: %O', message.id, error);
    }
    await adapter.handleForwardedMessage(message, options);

    return okResponse();
  };

  // The adapter builds every message with `edited: false`. Mark the ones dispatched from an edit,
  // so the wake decision is recorded apart from the one made when the message was sent.
  const originalHandleIncomingMessage = chatBot.handleIncomingMessage.bind(chatBot);
  chatBot.handleIncomingMessage = (incomingAdapter, threadId, message: Message) => {
    const editedAt = (message.raw as GatewayMessage | undefined)?.edited_timestamp;
    if ((incomingAdapter as unknown) === adapter && editedAt) {
      message.metadata = { ...message.metadata, edited: true, editedAt: new Date(editedAt) };
    }

    return originalHandleIncomingMessage(incomingAdapter, threadId, message);
  };

  adapter[PATCHED_FLAG] = true;
};

import { WEBHOOK_HEADERS } from '@lobechat/types';
import { z } from 'zod';

/**
 * Wire protocol of the custom webhook channel — see `protocol-spec.md` and the public
 * docs at `docs/usage/channels/webhook.mdx`. Both directions are JSON, signed with the
 * developer webhook scheme (`X-LobeHub-Signature: v1=<hex HMAC-SHA256(secret,
 * "<timestamp>.<raw body>")>` + `X-LobeHub-Timestamp`), using the bot's signing secret.
 */

export const WEBHOOK_PLATFORM_ID = 'webhook';

/** A UUID-shaped Bot ID is refused: the inbound route reads a UUID as the bot's REST id. */
export const BOT_ID_PATTERN =
  '^(?![\\dA-Fa-f]{8}-[\\dA-Fa-f]{4}-[\\dA-Fa-f]{4}-[\\dA-Fa-f]{4}-[\\dA-Fa-f]{12}$)[A-Za-z0-9][A-Za-z0-9_-]{2,63}$';
export const MIN_SIGNING_SECRET_LENGTH = 32;

/** Same header names as developer webhooks, so one verifier serves both. */
export const BOT_WEBHOOK_HEADERS = WEBHOOK_HEADERS;

/** An inbound request whose timestamp is further than this from now is refused (replay). */
export const BOT_WEBHOOK_TOLERANCE_SECONDS = 300;

/** The largest inbound body accepted; attachments travel by URL, not inline. */
export const BOT_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const BOT_WEBHOOK_ATTACHMENT_TYPES = ['image', 'file', 'video', 'audio'] as const;

// ---------------------------------------------------------------------------
// Inbound: the developer's platform → LobeHub
// ---------------------------------------------------------------------------

export const BotWebhookInboundAttachmentSchema = z.object({
  mimeType: z.string().max(255).optional(),
  name: z.string().max(255).optional(),
  size: z.number().int().nonnegative().optional(),
  type: z.enum(BOT_WEBHOOK_ATTACHMENT_TYPES),
  /** A public `https`/`http` URL LobeHub downloads (private addresses are refused). */
  url: z.string().url().max(2048),
});

export const BotWebhookInboundMessageSchema = z.object({
  attachments: z.array(BotWebhookInboundAttachmentSchema).max(10).optional(),
  /** The conversation (chat, room, channel) the message was sent in. */
  conversationId: z.string().min(1).max(255),
  /** Your id for this message, unique within its conversation / thread. */
  id: z.string().min(1).max(255),
  /** A one-to-one chat with the bot. Group messages need `mentioned` to wake it. */
  isDirect: z.boolean().optional().default(false),
  /** The message addresses the bot (an @-mention). Implied for direct messages. */
  mentioned: z.boolean().optional().default(false),
  text: z.string().max(32_000).optional().default(''),
  /** A sub-thread inside the conversation, when your platform has them. */
  threadId: z.string().min(1).max(255).optional(),
  /** When the message was sent: ISO 8601 or Unix milliseconds. Defaults to receipt time. */
  timestamp: z.union([z.string().datetime({ offset: true }), z.number().int()]).optional(),
  user: z.object({
    id: z.string().min(1).max(255),
    name: z.string().max(255).optional(),
  }),
});

export const BotWebhookInboundSchema = z.discriminatedUnion('type', [
  z.object({ message: BotWebhookInboundMessageSchema, type: z.literal('message') }),
  /** A connectivity check: answered `200 { ok: true }`, nothing is dispatched. */
  z.object({ type: z.literal('ping') }),
]);

export type BotWebhookInbound = z.infer<typeof BotWebhookInboundSchema>;
export type BotWebhookInboundMessage = z.infer<typeof BotWebhookInboundMessageSchema>;
export type BotWebhookInboundAttachment = z.infer<typeof BotWebhookInboundAttachmentSchema>;

// ---------------------------------------------------------------------------
// Outbound: LobeHub → the developer's callback URL
// ---------------------------------------------------------------------------

export const BOT_WEBHOOK_OUTBOUND_EVENTS = {
  /** The agent posted a message. */
  messageCreated: 'bot.message.created',
  /** The agent changed a message it posted earlier (`data.messageId`). */
  messageUpdated: 'bot.message.updated',
  /** Sent by "Test connection": answer any 2xx. */
  ping: 'bot.ping',
} as const;

export type BotWebhookOutboundEventType =
  (typeof BOT_WEBHOOK_OUTBOUND_EVENTS)[keyof typeof BOT_WEBHOOK_OUTBOUND_EVENTS];

export interface BotWebhookOutboundAttachment {
  /** Base64 bytes, only when the file has no URL. */
  data?: string;
  mimeType?: string;
  name?: string;
  size?: number;
  type: (typeof BOT_WEBHOOK_ATTACHMENT_TYPES)[number];
  /** A URL you can GET the bytes from (it may expire; download promptly). */
  url?: string;
}

export interface BotWebhookOutboundMessage {
  attachments: BotWebhookOutboundAttachment[];
  conversationId: string;
  isDirect: boolean;
  /** LobeHub's id for this message (`out_…`); an update carries the same id. */
  messageId: string;
  /** The message id a `POST /api/v1/bots/{id}/messages` call replied to; `null` otherwise. */
  replyTo: string | null;
  text: string;
  threadId: string | null;
}

export interface BotWebhookOutboundEvent {
  /** The bot's Bot ID (its application id). */
  botId: string;
  createdAt: string;
  data: BotWebhookOutboundMessage | { message: string };
  /** Unique per event (`evt_…`), stable across retries: deduplicate on it. */
  id: string;
  type: BotWebhookOutboundEventType;
}

// ---------------------------------------------------------------------------
// Thread ids: `webhook:[bot=<botId>:]<direct|group>:<conversationId>[:<threadId>]`
//
// The bot belongs in the thread identity: two webhook bots that both use
// conversation `1` would otherwise share one `thread.id`, and the active-thread
// guard in `AgentBridgeService` silently drops the second bot's message as
// "already running". The developer still gets their own ids back — `bot=<id>`
// is a distinct segment, so `conversationId` / `threadId` decode unchanged.
// ---------------------------------------------------------------------------

export interface BotWebhookThread {
  /** The bot this thread belongs to; it scopes the internal thread identity. */
  botId?: string;
  conversationId: string;
  isDirect: boolean;
  threadId?: string;
}

/** Marks the bot segment, so it never reads like the `direct` / `group` kind. */
const BOT_SEGMENT = 'bot=';

/** Components are URI-encoded, so ids containing `:` survive the round-trip. */
export const encodeWebhookThreadId = ({
  botId,
  conversationId,
  isDirect,
  threadId,
}: BotWebhookThread) =>
  [
    WEBHOOK_PLATFORM_ID,
    ...(botId ? [`${BOT_SEGMENT}${encodeURIComponent(botId)}`] : []),
    isDirect ? 'direct' : 'group',
    encodeURIComponent(conversationId),
    ...(threadId ? [encodeURIComponent(threadId)] : []),
  ].join(':');

export const decodeWebhookThreadId = (platformThreadId: string): BotWebhookThread => {
  const [platform, ...segments] = platformThreadId.split(':');
  const bare: BotWebhookThread = { conversationId: platformThreadId, isDirect: false };
  if (platform !== WEBHOOK_PLATFORM_ID || segments.length === 0) {
    // A bare id (e.g. a REST caller's `channelId`) is a group conversation of that name.
    return bare;
  }

  const bot = segments[0]?.startsWith(BOT_SEGMENT) ? segments.shift()! : undefined;
  const [kind, conversation, thread] = segments;
  if (!conversation) return bare;

  return {
    ...(bot ? { botId: decodeURIComponent(bot.slice(BOT_SEGMENT.length)) } : {}),
    conversationId: decodeURIComponent(conversation),
    isDirect: kind === 'direct',
    ...(thread ? { threadId: decodeURIComponent(thread) } : {}),
  };
};

import { WEBHOOK_HEADERS } from '@lobechat/types';
import { z } from 'zod';

/**
 * Wire protocol of the custom webhook channel — see `protocol-spec.md` and the public
 * docs at `docs/usage/channels/webhook.mdx`. Both directions are JSON, signed with the
 * developer webhook scheme (`X-LobeHub-Signature: v1=<hex HMAC-SHA256(secret,
 * "<timestamp>.<raw body>")>` + `X-LobeHub-Timestamp`), using the bot's signing secret.
 */

export const WEBHOOK_PLATFORM_ID = 'webhook';

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
  /** Your id for this message; replies reference it as `replyTo`. */
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
  /** The inbound message id this answers, when known. */
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
// Thread ids: `webhook:<direct|group>:<conversationId>[:<threadId>]`
// ---------------------------------------------------------------------------

export interface BotWebhookThread {
  conversationId: string;
  isDirect: boolean;
  threadId?: string;
}

/** Components are URI-encoded, so ids containing `:` survive the round-trip. */
export const encodeWebhookThreadId = ({ conversationId, isDirect, threadId }: BotWebhookThread) =>
  [
    WEBHOOK_PLATFORM_ID,
    isDirect ? 'direct' : 'group',
    encodeURIComponent(conversationId),
    ...(threadId ? [encodeURIComponent(threadId)] : []),
  ].join(':');

export const decodeWebhookThreadId = (platformThreadId: string): BotWebhookThread => {
  const [platform, kind, conversation, thread] = platformThreadId.split(':');
  if (platform !== WEBHOOK_PLATFORM_ID || !conversation) {
    // A bare id (e.g. a REST caller's `channelId`) is a group conversation of that name.
    return { conversationId: platformThreadId, isDirect: false };
  }
  return {
    conversationId: decodeURIComponent(conversation),
    isDirect: kind === 'direct',
    ...(thread ? { threadId: decodeURIComponent(thread) } : {}),
  };
};

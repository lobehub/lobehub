/**
 * Linq REST v3 + webhook types.
 *
 * Deliberately hand-written and dependency-light: the LobeHub server's
 * outbound / proactive-push path must not pull the chat SDK (and therefore the
 * whole agent runtime) into a serverless function just to send one DM, the same
 * reason `chat-adapter-imessage`'s `BlueBubblesApiClient` is standalone.
 *
 * Shapes mirror `@linqapp/sdk` (v0.75) — see `resources/chats/chats.d.ts`,
 * `resources/chats/messages.d.ts`, `resources/attachments.d.ts` and
 * `resources/webhook-events.d.ts` upstream.
 */

/** Linq's production REST base. `LINQ_BASE_URL` may override it (staging, mock). */
export const LINQ_DEFAULT_BASE_URL = 'https://api.linqapp.com/v3';

export interface LinqApiConfig {
  /** Bearer token issued by Linq for the partner account. */
  apiKey: string;
  /**
   * REST base URL. Defaults to `LINQ_DEFAULT_BASE_URL`. Point this at a local
   * mock in tests / local acceptance.
   */
  baseUrl?: string;
  /**
   * The LobeHub-owned Linq (iMessage) number in E.164 — the `from` for chats
   * LobeHub opens itself (proactive push). Inbound chats already carry it.
   */
  fromNumber?: string;
  requestTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Message parts
// ---------------------------------------------------------------------------

export interface LinqTextPart {
  type: 'text';
  /**
   * Sent verbatim. Markdown is NOT parsed by Linq — degrade it before building
   * a part (see `toPlainText` in `./format-converter`).
   */
  value: string;
}

/**
 * Media part. Exactly one of `url` (public HTTPS, ≤10MB) or `attachment_id`
 * (pre-uploaded via `POST /v3/attachments`, ≤100MB) must be set.
 */
export interface LinqMediaPart {
  attachment_id?: string;
  sticker?: boolean;
  type: 'media';
  url?: string;
}

/** A rich preview card. Must be the ONLY part in its message. */
export interface LinqLinkPart {
  type: 'link';
  value: string;
}

export type LinqMessagePart = LinqLinkPart | LinqMediaPart | LinqTextPart;

export interface LinqMessageContent {
  parts: LinqMessagePart[];
  preferred_service?: string;
  reply_to?: { message_id: string };
}

// ---------------------------------------------------------------------------
// Chats / messages
// ---------------------------------------------------------------------------

export interface LinqChat {
  created_at?: string;
  display_name?: string | null;
  handles?: unknown[];
  id: string;
  is_archived?: boolean;
  is_group?: boolean;
  service?: string;
}

export interface LinqSentMessage {
  created_at?: string;
  delivery_status?: 'pending' | 'queued' | 'sent' | 'delivered' | 'received' | 'read' | 'failed';
  id: string;
  parts?: unknown[];
  sent_at?: string | null;
}

/** `POST /v3/chats` — opens the chat AND sends the first message. */
export interface LinqChatCreateResponse {
  chat: LinqChat;
}

/** `POST /v3/chats/{chatId}/messages`. */
export interface LinqMessageSendResponse {
  chat_id: string;
  message: LinqSentMessage;
}

/** `GET /v3/chats`. */
export interface LinqChatListResponse {
  chats?: LinqChat[];
  next_cursor?: string | null;
}

export interface LinqSendOptions {
  /**
   * Dedupes retries of the same logical send. Must be stable across retries to
   * have any effect. Max 255 chars.
   */
  idempotencyKey?: string;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** `POST /v3/attachments` — presigned upload + reusable id. */
export interface LinqAttachmentCreateResponse {
  attachment_id: string;
  /** `PUT` the raw bytes here with `required_headers`, within 15 minutes. */
  http_method?: 'PUT';
  required_headers?: Record<string, string> | null;
  upload_url: string;
}

export interface LinqOutboundAttachment {
  /** Raw bytes, base64. Mutually exclusive with `fetchUrl`. */
  data?: string;
  /** Public HTTPS URL to pull the bytes from. Mutually exclusive with `data`. */
  fetchUrl?: string;
  mimeType?: string;
  name?: string;
  /** Known byte size, used to skip a HEAD probe when uploading `fetchUrl`. */
  size?: number;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Headers Linq sets on every delivery (Standard Webhooks). */
export interface LinqWebhookSignatureHeaders {
  /** `webhook-id` — unique per delivery, the dedupe key. */
  id: string;
  /** `webhook-signature` — space-separated `v1,<base64>` entries. */
  signature: string;
  /** `webhook-timestamp` — unix seconds. */
  timestamp: string;
}

export interface LinqWebhookEvent<TData = LinqInboundMessage> {
  [key: string]: unknown;
  data: TData;
  /** e.g. `message.received`. */
  event_type: string;
}

/** The `message.received` payload — the inbound half we route to agents. */
export interface LinqInboundMessage {
  [key: string]: unknown;
  chat: { id: string; is_group?: boolean };
  /** `inbound` for messages sent TO the LobeHub number. */
  direction?: 'inbound' | 'outbound';
  id: string;
  parts?: LinqMessagePart[];
  /** Phone number of the human, when Linq resolved one. */
  sender?: { handle?: string } | string | null;
  sender_handle?: { handle?: string; id?: string; service?: string } | null;
  sent_at?: string | null;
}

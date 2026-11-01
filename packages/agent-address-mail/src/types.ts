/**
 * Types for the Agent Mail (`lobe.id`) email adapter.
 *
 * The service is documented at https://api.lobe.id — an agent owns one inbox
 * (`k7x2p9mq4d@lobe.id`) and receives mail through a signed webhook. The
 * webhook payload deliberately carries only a *summary*: the body must be
 * fetched back through `GET /v1/messages/:id`.
 */

/** Address object as the API serialises sender/recipients. */
export interface EmailAddress {
  address: string;
  name?: string;
}

/** Message summary — the shape embedded in a `message.received` webhook event. */
export interface EmailMessageSummary {
  attachments: Array<{
    contentType?: string;
    filename?: string | null;
    index: number;
    size?: number;
  }>;
  /** Verification codes extracted by the service, best first. */
  codes: string[];
  direction: 'inbound' | 'outbound';
  from: EmailAddress | null;
  id: string;
  inboxId: string;
  /** Verification / magic links extracted by the service. */
  links: string[];
  read: boolean;
  receivedAt: string;
  snippet: string | null;
  status: string;
  subject: string | null;
  to: EmailAddress[];
}

/** Full message — `GET /v1/messages/:id`. */
export interface EmailMessageDetail extends EmailMessageSummary {
  bcc: EmailAddress[];
  cc: EmailAddress[];
  envelope: { from: string | null; to: string | null };
  error: string | null;
  html: string | null;
  inReplyTo: string | null;
  messageId: string | null;
  references: string[];
  replyTo: EmailAddress[];
  size: number;
  text: string | null;
}

export interface EmailInbox {
  address: string;
  clientId: string | null;
  createdAt: string;
  displayName: string | null;
  endUserId: string | null;
  id: string;
  metadata: Record<string, unknown>;
}

export interface EmailWebhook {
  createdAt: string;
  enabled: boolean;
  events: string[];
  id: string;
  inboxId: string | null;
  /** Only present in the creation response. */
  secret?: string;
  url: string;
}

/** Webhook envelope. `id` is stable for a delivery attempt series (retries reuse it). */
export interface EmailWebhookEvent {
  createdAt: string;
  data: {
    inbox: { address: string; clientId: string | null; id: string };
    message: EmailMessageSummary;
  };
  id: string;
  type: 'message.received';
}

/** chat-sdk thread identity: `email:<threadKey>`. */
export interface EmailThreadId {
  /** Root conversation key — the first `References` entry, else the message id. */
  id: string;
}

/**
 * Raw inbound payload handed to `Message.raw`. Carries the summary plus the
 * resolved thread/body so the server-side client can download attachments
 * without a second round trip to the webhook payload.
 */
export interface EmailRawMessage {
  /** Webhook envelope this inbound message came from (absent on outbound). */
  event?: EmailWebhookEvent;
  message: EmailMessageSummary;
  /** Body with the quoted history stripped. */
  text: string;
  threadKey: string;
}

/** Per-thread outbound state, shared between the adapter and the platform client. */
export interface EmailThreadRecord {
  /** Sender we reply to (Reply-To unless the mail was a bulk send). */
  from: string;
  /** Message id the next reply should thread under. */
  lastMessageId: string;
  subject: string | null;
}

export interface EmailAdapterConfig {
  /** The inbox address, used to detect self-addressed mail. */
  address?: string;
  apiBaseUrl?: string;
  /** Agent Mail API key (`am_…`). */
  apiKey: string;
  /** Injectable fetch, for tests. */
  fetchImpl?: typeof fetch;
  /** Inbox id (`inb_…`) — reply target and `POST /v1/inboxes/:id/messages` owner. */
  inboxId?: string;
  /** Reject webhook timestamps older than this, in seconds. Default 300 (5 min). */
  signatureToleranceSeconds?: number;
  /** Shared thread state so outbound replies land in the right thread. */
  threadState?: Map<string, EmailThreadRecord>;
  userName?: string;
  /** Webhook signing secret, returned once by `POST /v1/webhooks`. */
  webhookSecret: string;
}

export interface EmailApiError {
  error?: { code?: string; message?: string };
}

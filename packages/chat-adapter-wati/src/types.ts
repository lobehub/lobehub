/**
 * Inbound webhook payload for a customer text message.
 * @see https://docs.wati.io/reference/message-received
 */
export interface WatiInboundMessage {
  avatarUrl?: string | null;
  channelId?: string | null;
  channelPhoneNumber?: string | null;
  conversationId?: string;
  created?: string;
  data?: unknown;
  eventType?: string;
  id?: string;
  owner?: boolean;
  replyContextId?: string;
  senderName?: string;
  sourceId?: string | null;
  sourceUrl?: string | null;
  statusString?: string;
  text?: string | null;
  ticketId?: string;
  timestamp?: string;
  type?: string;
  waId?: string;
  whatsappMessageId?: string;
}

export interface WatiAdapterConfig {
  /** WATI API host, e.g. https://live-mt-server.wati.io */
  apiBaseUrl: string;
  bearerToken: string;
  /** Business WhatsApp channel number (digits, country code, no +). Matches inbound `channelPhoneNumber`. */
  channelPhoneNumber: string;
  tenantId: string;
}

export interface WatiThreadId {
  id: string;
  type: 'user';
}

export type WatiRawMessage = WatiInboundMessage;

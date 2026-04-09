export interface DingTalkInboundTextBody {
  content?: string;
}

/**
 * Inbound DingTalk chatbot webhook payload (best-effort subset).
 *
 * We keep this type intentionally permissive because DingTalk can send different
 * shapes depending on webhook config (encrypted vs plaintext) and message type.
 */
export interface DingTalkInboundMessagePayload {
  [key: string]: unknown;
  conversationId?: string;
  /**
   * DingTalk commonly uses:
   * - "1": single chat (DM)
   * - "2": group chat
   */
  conversationType?: string;
  // Encrypted webhook envelope
  encrypt?: string;
  isInAtList?: boolean;
  msgId?: string;
  msgtype?: string;
  senderId?: string;
  senderNick?: string;
  sessionWebhook?: string;

  sessionWebhookExpiredTime?: number;

  text?: DingTalkInboundTextBody;
}

export interface DingTalkThreadId {
  id: string;
  type: 'dm' | 'group';
}

export interface DingTalkNormalizedInboundMessage {
  authorId: string;
  authorName?: string;
  id: string;
  isMention: boolean;
  raw: DingTalkInboundMessagePayload;
  text: string;
  threadId: string;
  timestamp: Date;
}

export interface DingTalkNormalizeOptions {
  botName: string;
  /**
   * Group chats can be noisy. For DingTalk, we ignore group messages unless the bot
   * is explicitly mentioned (default: true).
   */
  requireMentionInGroup?: boolean;
  /**
   * If true, remove the leading "@BotName" from visible text while preserving
   * structured mention information via `isMention`.
   */
  stripBotMention?: boolean;
}

export interface DingTalkWebhookCryptoInput {
  encrypt: string;
  nonce: string;
  timestamp: string;
  token: string;
}

export interface DingTalkWebhookEncryptedResponse {
  encrypt: string;
  msg_signature: string;
  nonce: string;
  timeStamp: string;
}

export interface DingTalkDecryptedEvent {
  message: string;
  receiverId: string;
}

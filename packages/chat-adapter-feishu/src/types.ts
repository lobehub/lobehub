/**
 * Lark/Feishu adapter configuration.
 */
export interface LarkAdapterConfig {
  /** Lark app ID */
  appId: string;
  /** Lark app secret */
  appSecret: string;
  /** AES decrypt key for encrypted events (optional) */
  encryptKey?: string;
  /** 'lark' (international) or 'feishu' (China) — determines API base URL */
  platform?: 'lark' | 'feishu';
  /** Bot display name override */
  userName?: string;
  /** Verification token for webhook event validation (optional — skip verification when unset) */
  verificationToken?: string;
}

/**
 * Lark thread ID components.
 */
export interface LarkThreadId {
  /** Lark chat ID (group or P2P) */
  chatId: string;
  /**
   * Lark chat type, encoded into the threadId so the sync `isDM(threadId)`
   * the Chat SDK requires can derive the answer without a side cache.
   * `undefined` means unknown — produced by paths that don't have the chat
   * type at hand (e.g. `parseMessage` for historical fetches), and decoded
   * back from the legacy 2-segment threadId format for backward compat.
   */
  chatType?: 'p2p' | 'group';
  /** Platform variant */
  platform: 'lark' | 'feishu';
}

/**
 * Lark sender info from im.message.receive_v1 event.
 */
export interface LarkSender {
  sender_id: {
    open_id: string;
    union_id?: string;
    user_id?: string;
  };
  sender_type: string;
  tenant_key?: string;
}

/**
 * Lark message body from im.message.receive_v1 event.
 */
export interface LarkMessageBody {
  chat_id: string;
  chat_type?: string;
  content: string;
  create_time: string;
  mentions?: LarkMention[];
  message_id: string;
  message_type: string;
}

export interface LarkMention {
  id: { open_id: string; union_id?: string; user_id?: string };
  key: string;
  name: string;
  tenant_key?: string;
}

/**
 * Lark event header.
 */
export interface LarkEventHeader {
  app_id: string;
  create_time: string;
  event_id: string;
  event_type: string;
  tenant_key: string;
  token: string;
}

/**
 * Lark im.message.receive_v1 event body.
 */
export interface LarkMessageEvent {
  message: LarkMessageBody;
  sender: LarkSender;
}

/**
 * Full Lark webhook payload (Event Subscription v2).
 */
export interface LarkWebhookPayload {
  challenge?: string;
  encrypt?: string;
  event?: LarkMessageEvent;
  header?: LarkEventHeader;
  /** Verification token — present at top level in url_verification events */
  token?: string;
  type?: string;
}

/** Raw message type for the adapter generic */
export type LarkRawMessage = LarkMessageBody;

// ---------- Adapter config ----------

export interface LineAdapterConfig {
  /**
   * Optional Messaging API base URL override (default `https://api.line.me`).
   */
  apiBaseUrl?: string;
  /**
   * Optional content (binary download) base URL override
   * (default `https://api-data.line.me`).
   */
  apiDataBaseUrl?: string;
  /**
   * Long-lived **Channel Access Token** issued from the LINE Developers
   * Console (Messaging API tab → "Issue token").
   */
  channelAccessToken: string;
  /**
   * **Channel Secret** from the same console page. Used to validate
   * `X-Line-Signature` on every inbound webhook delivery.
   */
  channelSecret: string;
  /**
   * The bot's destination user ID (`U` + 32 hex chars). Available from
   * `GET /v2/bot/info` and from every webhook payload's `destination`
   * field. Used as the bot identity and as the route segment.
   */
  destinationUserId: string;
}

export interface LineThreadId {
  /** Original id from `event.source` (userId / groupId / roomId). */
  id: string;
  /** LINE chat type. */
  type: 'group' | 'room' | 'user';
}

// ---------- Webhook payload types (subset of LINE's spec we use) ----------

export type LineSourceType = 'group' | 'room' | 'user';

export interface LineSource {
  /** Group ID — only when `type === 'group'`. */
  groupId?: string;
  /** Room ID — only when `type === 'room'`. */
  roomId?: string;
  type: LineSourceType;
  /** User ID of the sender. Always present for messages. */
  userId?: string;
}

export type LineMessageContentType =
  | 'audio'
  | 'file'
  | 'image'
  | 'location'
  | 'sticker'
  | 'text'
  | 'video';

export interface LineTextMessage {
  id: string;
  text: string;
  type: 'text';
}

export interface LineMediaMessage {
  contentProvider?: {
    originalContentUrl?: string;
    previewImageUrl?: string;
    type: 'external' | 'line';
  };
  /** Audio / Video duration in ms. */
  duration?: number;
  /** File messages only. */
  fileName?: string;
  /** File size in bytes. */
  fileSize?: number;
  id: string;
  type: 'audio' | 'file' | 'image' | 'video';
}

export interface LineStickerMessage {
  id: string;
  /** Sticker keyword(s) the sender intended (LINE may attach multiple). */
  keywords?: string[];
  packageId: string;
  stickerId: string;
  /** Optional human-readable text alternative. */
  text?: string;
  type: 'sticker';
}

export interface LineLocationMessage {
  address?: string;
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  type: 'location';
}

export type LineMessage =
  | LineLocationMessage
  | LineMediaMessage
  | LineStickerMessage
  | LineTextMessage;

export interface LineMessageEvent {
  deliveryContext?: { isRedelivery: boolean };
  message: LineMessage;
  mode: 'active' | 'standby';
  /** Quoted message context (LINE's reply-to indicator). */
  quotedMessageId?: string;
  /** `replyToken` is single-use and expires in ~60s. We rely on push API
   *  instead for outbound, so we treat this as informational. */
  replyToken?: string;
  source: LineSource;
  /** Unix milliseconds. */
  timestamp: number;
  type: 'message';
  webhookEventId?: string;
}

export interface LineGenericEvent {
  // Other event types (follow / unfollow / join / leave / postback / memberJoined
  // / memberLeft / accountLink / things / videoPlayComplete / unsend) carry
  // their own fields. The adapter only consumes `message` events today; we
  // keep this open type so future extensions don't need a new enum.
  [extra: string]: unknown;
  deliveryContext?: { isRedelivery: boolean };
  source: LineSource;
  timestamp: number;
  type: string;
  webhookEventId?: string;
}

export type LineWebhookEvent = LineGenericEvent | LineMessageEvent;

export interface LineWebhookPayload {
  /** Bot's userId (matches `LineAdapterConfig.destinationUserId`). */
  destination: string;
  events: LineWebhookEvent[];
}

// ---------- Outbound API ----------

export interface LinePushMessageRequest {
  messages: Array<{ text: string; type: 'text' }>;
  /** Optional notification disabling. */
  notificationDisabled?: boolean;
  /** Recipient: userId / groupId / roomId. */
  to: string;
}

export interface LineApiError {
  details?: Array<{ message?: string; property?: string }>;
  message?: string;
}

export interface LineBotInfoResponse {
  basicId?: string;
  chatMode?: string;
  displayName?: string;
  markAsReadMode?: string;
  pictureUrl?: string;
  premiumId?: string;
  /** Bot's userId — matches the `destination` field on inbound webhooks. */
  userId?: string;
}

export interface LineLoadingStartRequest {
  /** Recipient userId. The loading animation only works for 1:1 user chats. */
  chatId: string;
  /** 5–60 seconds, multiples of 5. */
  loadingSeconds?: number;
}

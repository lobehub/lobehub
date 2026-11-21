// ---- Adapter config ----

export interface DingTalkAdapterConfig {
  /** Client ID (formerly AppKey) of the internal app */
  clientId: string;
  /** Client Secret (formerly AppSecret) of the internal app */
  clientSecret: string;
  /**
   * Robot code used by the robot send APIs. For an internal-app robot it is the
   * same value as the Client ID, which is the default.
   */
  robotCode?: string;
}

/**
 * Thread identity.
 *
 * - `single`: one-on-one chat, `id` is the sender's `senderStaffId` (the
 *   recipient used by `oToMessages/batchSend`).
 * - `group`: group chat, `id` is the `openConversationId` (callback
 *   `conversationId`, the target used by `groupMessages/send`).
 */
export interface DingTalkThreadId {
  id: string;
  type: 'single' | 'group';
}

// ---- Stream mode (WebSocket) ----

export const DINGTALK_STREAM_TOPICS = {
  /** Robot message callback */
  BOT_MESSAGE: '/v1.0/im/bot/messages/get',
  /** System: graceful close, server drops TCP ~10s later */
  DISCONNECT: 'disconnect',
  /** System: health check, echo `opaque` back */
  PING: 'ping',
} as const;

export const DINGTALK_STREAM_FRAME_TYPES = {
  CALLBACK: 'CALLBACK',
  EVENT: 'EVENT',
  SYSTEM: 'SYSTEM',
} as const;

export interface DingTalkStreamSubscription {
  topic: string;
  type: 'CALLBACK' | 'EVENT';
}

export interface DingTalkConnectionOpenRequest {
  clientId: string;
  clientSecret: string;
  localIp?: string;
  subscriptions: DingTalkStreamSubscription[];
  ua?: string;
}

export interface DingTalkConnectionOpenResponse {
  /** WebSocket endpoint (wss://...) */
  endpoint: string;
  /** One-shot ticket, valid for 90 seconds */
  ticket: string;
}

export interface DingTalkStreamFrameHeaders {
  [key: string]: string | undefined;
  contentType?: string;
  messageId: string;
  time?: string;
  topic: string;
}

/** A frame pushed by the server over the Stream WebSocket */
export interface DingTalkStreamFrame {
  /** JSON string; shape depends on the topic */
  data: string;
  headers: DingTalkStreamFrameHeaders;
  specVersion?: string;
  type: 'SYSTEM' | 'EVENT' | 'CALLBACK';
}

/** ACK frame sent back by the client */
export interface DingTalkStreamAck {
  code: number;
  /** JSON string */
  data: string;
  headers: { contentType: 'application/json'; messageId: string };
  message: string;
}

// ---- Robot message callback ----

export const DINGTALK_CONVERSATION_TYPE = {
  GROUP: '2',
  SINGLE: '1',
} as const;

export interface DingTalkAtUser {
  dingtalkId: string;
  staffId?: string;
}

export interface DingTalkRichTextItem {
  downloadCode?: string;
  pictureDownloadCode?: string;
  text?: string;
  type?: string;
}

export interface DingTalkMessageContent {
  downloadCode?: string;
  /** audio / video duration */
  duration?: number | string;
  /** file name (msgtype=file) */
  fileName?: string;
  pictureDownloadCode?: string;
  /** speech-to-text result (msgtype=audio) */
  recognition?: string;
  richText?: DingTalkRichTextItem[];
  videoType?: string;
}

export type DingTalkInboundMsgType = 'text' | 'richText' | 'picture' | 'audio' | 'video' | 'file';

/**
 * Robot message callback payload (`data` of the `/v1.0/im/bot/messages/get`
 * frame, or the body of an HTTP-mode callback).
 */
export interface DingTalkRawMessage {
  atUsers?: DingTalkAtUser[];
  chatbotCorpId?: string;
  chatbotUserId?: string;
  content?: DingTalkMessageContent;
  conversationId: string;
  conversationTitle?: string;
  /** '1' = single chat, '2' = group chat */
  conversationType: string;
  createAt?: number;
  isAdmin?: boolean;
  isInAtList?: boolean;
  msgId: string;
  msgtype: string;
  robotCode?: string;
  senderCorpId?: string;
  senderId: string;
  senderNick?: string;
  /** Present for members of the robot's organization */
  senderStaffId?: string;
  sessionWebhook?: string;
  /** Unix ms */
  sessionWebhookExpiredTime?: number;
  text?: { content: string };
}

// ---- OpenAPI ----

export interface DingTalkAccessTokenResponse {
  accessToken: string;
  /** seconds */
  expireIn: number;
}

/** Robot message template keys (`msgKey`) */
export const DINGTALK_MSG_KEYS = {
  IMAGE: 'sampleImageMsg',
  MARKDOWN: 'sampleMarkdown',
  TEXT: 'sampleText',
} as const;

export type DingTalkOutboundMessage =
  | { msgKey: 'sampleText'; msgParam: { content: string } }
  | { msgKey: 'sampleMarkdown'; msgParam: { text: string; title: string } }
  | { msgKey: 'sampleImageMsg'; msgParam: { photoURL: string } };

export interface DingTalkBatchSendResponse {
  flowControlledStaffIdList?: string[];
  invalidStaffIdList?: string[];
  processQueryKey: string;
}

export interface DingTalkGroupSendResponse {
  processQueryKey: string;
}

export interface DingTalkFileDownloadResponse {
  downloadUrl: string;
}

/** Error body of the v1.0 OpenAPI */
export interface DingTalkApiErrorBody {
  code?: string;
  message?: string;
  requestid?: string;
}

/** Response of a sessionWebhook POST */
export interface DingTalkSessionWebhookResponse {
  errcode?: number;
  errmsg?: string;
}

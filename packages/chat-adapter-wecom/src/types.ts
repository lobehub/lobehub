/**
 * WeCom (企业微信) AI bot — long-connection protocol types.
 *
 * Source: the official long-connection docs
 * (https://developer.work.weixin.qq.com/document/path/101463, checked 2026-11-05) and the
 * official Node SDK `@wecom/aibot-node-sdk@1.0.7` (MIT), whose frame shapes these mirror. The
 * SDK itself is not a dependency: it pulls in axios + ws and owns its own reconnect loop, while
 * the gateway here needs to forward frames into the webhook pipeline and keep outbound replies
 * on the same socket.
 */

export const WECOM_DEFAULT_WS_URL = 'wss://openws.work.weixin.qq.com';

export const WECOM_CMD = {
  /** Event push (enter_chat, disconnected_event, …). */
  EVENT_CALLBACK: 'aibot_event_callback',
  /** Heartbeat; the server answers with a frame that carries the same req_id. */
  HEARTBEAT: 'ping',
  /** Message push (text / image / mixed / voice / file / video). */
  MSG_CALLBACK: 'aibot_msg_callback',
  /** Passive reply on the req_id of an inbound callback. */
  RESPOND: 'aibot_respond_msg',
  /** Proactive push to a chat the user already talked to the bot in. */
  SEND_MSG: 'aibot_send_msg',
  /** Authenticate the connection with BotID + Secret. */
  SUBSCRIBE: 'aibot_subscribe',
} as const;

/** `{ cmd, headers: { req_id }, body }` — every frame in both directions. */
export interface WeComFrame<T = any> {
  body?: T;
  cmd?: string;
  /** Present on acks (subscribe / ping / reply receipts). */
  errcode?: number;
  errmsg?: string;
  headers: { [key: string]: any; req_id: string };
}

export type WeComChatType = 'single' | 'group';

export interface WeComMedia {
  /** Per-URL AES-256-CBC key (base64), only sent on the long connection. */
  aeskey?: string;
  /** Encrypted download URL, valid for 5 minutes. */
  url: string;
}

export interface WeComMixedItem {
  image?: WeComMedia;
  msgtype: 'text' | 'image';
  text?: { content: string };
}

export interface WeComQuote {
  file?: WeComMedia;
  image?: WeComMedia;
  mixed?: { msg_item: WeComMixedItem[] };
  msgtype: 'text' | 'image' | 'mixed' | 'voice' | 'file';
  text?: { content: string };
  voice?: { content: string };
}

/** Body of an `aibot_msg_callback` frame. */
export interface WeComMessageBody {
  aibotid: string;
  /** Group chat id; only present when `chattype === 'group'`. */
  chatid?: string;
  chattype: WeComChatType;
  create_time?: number;
  file?: WeComMedia;
  /**
   * Sender. `userid` is plain text only when the bot creator is a super admin; otherwise it is an
   * encrypted open_userid, which is still stable per user and bot (未实测).
   */
  from: { userid: string };
  image?: WeComMedia;
  mixed?: { msg_item: WeComMixedItem[] };
  /** Dedup key for this callback. */
  msgid: string;
  msgtype: 'text' | 'image' | 'mixed' | 'voice' | 'file' | 'video' | string;
  quote?: WeComQuote;
  text?: { content: string };
  video?: WeComMedia;
  /** Voice arrives already transcribed. */
  voice?: { content: string };
}

/** The frame the gateway forwards to the webhook: the inbound frame, unchanged. */
export type WeComForwardedFrame = WeComFrame<WeComMessageBody>;

export interface WeComThreadId {
  /** `single` → the sender's userid; `group` → the group chatid. */
  id: string;
  type: WeComChatType;
}

/** Raw message carried on chat SDK `Message.raw`. */
export interface WeComRawMessage {
  body: WeComMessageBody;
  /** req_id of the inbound frame; a passive reply must echo it. */
  reqId: string;
}

export interface WeComAdapterConfig {
  botId: string;
  secret: string;
  userName?: string;
}

/** Stream reply body (`msgtype: 'stream'`). Content is markdown, at most 20480 bytes. */
export interface WeComStreamBody {
  msgtype: 'stream';
  stream: { content?: string; finish?: boolean; id: string };
}

/** Proactive markdown push body. */
export interface WeComMarkdownBody {
  markdown: { content: string };
  msgtype: 'markdown';
}

/** Stream / markdown content limit in bytes (UTF-8). */
export const WECOM_MAX_CONTENT_BYTES = 20_480;

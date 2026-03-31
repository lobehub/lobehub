export interface WechatAdapterConfig {
  /** Bot's iLink user ID (from QR login) */
  botId?: string;
  /** Bot token obtained from iLink QR code authentication */
  botToken: string;
}

export interface WechatThreadId {
  /** The WeChat user ID (xxx@im.wechat format) */
  id: string;
  /** Chat type */
  type: 'single' | 'group';
}

// ---------- iLink protocol enums ----------

export enum MessageType {
  USER = 1,
  BOT = 2,
}

export enum MessageState {
  NEW = 0,
  GENERATING = 1,
  FINISH = 2,
}

export enum MessageItemType {
  TEXT = 1,
  IMAGE = 2,
  VOICE = 3,
  FILE = 4,
  VIDEO = 5,
}

// ---------- iLink API raw types ----------

export interface BaseInfo {
  channel_version: string;
}

export interface CDNMedia {
  aes_key?: string;
  encrypt_query_param?: string;
  encrypt_type?: 0 | 1;
}

export interface TextItem {
  text: string;
}

export interface ImageItem {
  aeskey?: string;
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  url?: string;
}

export interface VoiceItem {
  encode_type?: number;
  media?: CDNMedia;
  playtime?: number;
  text?: string;
}

export interface FileItem {
  file_name?: string;
  len?: string;
  md5?: string;
  media?: CDNMedia;
}

export interface VideoItem {
  media?: CDNMedia;
  play_length?: number;
  thumb_media?: CDNMedia;
  video_size?: string | number;
}

export interface MessageItem {
  file_item?: FileItem;
  image_item?: ImageItem;
  text_item?: TextItem;
  type: MessageItemType;
  video_item?: VideoItem;
  voice_item?: VoiceItem;
}

/** Raw message from getupdates */
export interface WechatRawMessage {
  client_id: string;
  context_token: string;
  create_time_ms: number;
  from_user_id: string;
  item_list: MessageItem[];
  message_id: number;
  message_state: MessageState;
  message_type: MessageType;
  to_user_id: string;
}

/** getupdates response */
export interface WechatGetUpdatesResponse {
  errcode?: number;
  errmsg?: string;
  get_updates_buf: string;
  longpolling_timeout_ms?: number;
  msgs: WechatRawMessage[];
  ret: number;
}

/** sendmessage request body */
export interface WechatSendMessageReq {
  base_info: BaseInfo;
  msg: {
    client_id: string;
    context_token: string;
    from_user_id: string;
    item_list: MessageItem[];
    message_state: MessageState;
    message_type: MessageType;
    to_user_id: string;
  };
}

/** sendmessage response */
export interface WechatSendMessageResponse {
  errmsg?: string;
  ret: number;
}

/** getconfig response */
export interface WechatGetConfigResponse {
  errcode?: number;
  errmsg?: string;
  ret?: number;
  typing_ticket?: string;
}

/** sendtyping request body */
export interface WechatSendTypingReq {
  base_info: BaseInfo;
  ilink_user_id: string;
  /** 1 = start, 2 = stop */
  status: 1 | 2;
  typing_ticket: string;
}

/** iLink API return codes */
export const WECHAT_RET_CODES = {
  /** Success */
  OK: 0,
  /** Session expired — requires re-authentication via QR code */
  SESSION_EXPIRED: -14,
} as const;

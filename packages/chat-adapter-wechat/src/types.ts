export interface WechatAdapterConfig {
  /** App token obtained from iLink Bot authentication */
  appToken: string;
}

export interface WechatThreadId {
  /** The WeChat user or group ID */
  id: string;
  /** Chat type: single user, group, or room */
  type: 'single' | 'group' | 'room';
}

export interface WechatAuthor {
  avatar?: string;
  id: string;
  nickname?: string;
}

export interface WechatRawMessage {
  content: string;
  contextToken?: string;
  from: WechatAuthor;
  /** Group ID if the message is from a group chat */
  groupId?: string;
  id: string;
  timestamp: number;
  to: string;
  type: number;
}

export interface WechatUpdate {
  message?: WechatRawMessage;
  updateId: number;
}

export interface WechatGetUpdatesResponse {
  data?: {
    updates: WechatUpdate[];
    nextOffset: number;
  };
  errcode: number;
  errmsg: string;
}

export interface WechatSendMessageParams {
  content: string;
  contextToken?: string;
  to: string;
  type?: number;
}

export interface WechatSendMessageResponse {
  data?: {
    msgId: string;
    timestamp: number;
  };
  errcode: number;
  errmsg: string;
}

export interface WechatBotInfoResponse {
  data?: {
    botId: string;
    nickname: string;
    avatar: string;
  };
  errcode: number;
  errmsg: string;
}

/** iLink API error codes */
export const WECHAT_ERROR_CODES = {
  /** Success */
  OK: 0,
  /** Session expired — requires re-authentication */
  SESSION_EXPIRED: -14,
  /** Invalid token */
  INVALID_TOKEN: -1,
} as const;

/** Message types */
export const WECHAT_MSG_TYPE = {
  TEXT: 1,
  IMAGE: 3,
  VOICE: 34,
  VIDEO: 43,
  LINK: 49,
} as const;

export interface WeixinAdapterConfig {
  /** App token obtained from iLink Bot authentication */
  appToken: string;
}

export interface WeixinThreadId {
  /** The WeChat user or group ID */
  id: string;
  /** Chat type: single user, group, or room */
  type: 'single' | 'group' | 'room';
}

export interface WeixinAuthor {
  avatar?: string;
  id: string;
  nickname?: string;
}

export interface WeixinRawMessage {
  content: string;
  contextToken?: string;
  from: WeixinAuthor;
  /** Group ID if the message is from a group chat */
  groupId?: string;
  id: string;
  timestamp: number;
  to: string;
  type: number;
}

export interface WeixinUpdate {
  message?: WeixinRawMessage;
  updateId: number;
}

export interface WeixinGetUpdatesResponse {
  data?: {
    updates: WeixinUpdate[];
    nextOffset: number;
  };
  errcode: number;
  errmsg: string;
}

export interface WeixinSendMessageParams {
  content: string;
  contextToken?: string;
  to: string;
  type?: number;
}

export interface WeixinSendMessageResponse {
  data?: {
    msgId: string;
    timestamp: number;
  };
  errcode: number;
  errmsg: string;
}

export interface WeixinBotInfoResponse {
  data?: {
    botId: string;
    nickname: string;
    avatar: string;
  };
  errcode: number;
  errmsg: string;
}

/** iLink API error codes */
export const WEIXIN_ERROR_CODES = {
  /** Success */
  OK: 0,
  /** Session expired — requires re-authentication */
  SESSION_EXPIRED: -14,
  /** Invalid token */
  INVALID_TOKEN: -1,
} as const;

/** Message types */
export const WEIXIN_MSG_TYPE = {
  TEXT: 1,
  IMAGE: 3,
  VOICE: 34,
  VIDEO: 43,
  LINK: 49,
} as const;

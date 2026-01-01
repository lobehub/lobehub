import { AgentRuntimeErrorType, ILobeAgentRuntimeErrorType } from '@lobechat/types';

export const AGENT_RUNTIME_ERROR_SET = new Set<string>(Object.values(AgentRuntimeErrorType));

/* eslint-disable sort-keys-fix/sort-keys-fix */
export const StandardErrorType = {
  // ******* Client Error ******* //
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  ContentNotFound: 404,
  MethodNotAllowed: 405,
  TooManyRequests: 429,

  // ******* Server Error ******* //
  InternalServerError: 500,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
} as const;
/* eslint-enable */

export type ErrorType = (typeof StandardErrorType)[keyof typeof StandardErrorType];

/**
 * 聊天消息错误对象
 */
export interface ChatMessageError {
  body?: any;
  message: string;
  type: ErrorType | ILobeAgentRuntimeErrorType;
}

export type { ILobeAgentRuntimeErrorType } from '@lobechat/types';
export { AgentRuntimeErrorType } from '@lobechat/types';

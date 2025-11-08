import type { ILobeAgentRuntimeErrorType } from '@lobechat/model-runtime';
import type { IPluginErrorType } from '@lobehub/chat-plugin-sdk';

import { ErrorType } from '../../fetch';

/**
 * 聊天消息错误对象
 */
export interface ChatMessageError {
  body?: any;
  message: string;
  type: ErrorType | IPluginErrorType | ILobeAgentRuntimeErrorType;
}

export interface ChatCitationItem {
  id?: string;
  onlyUrl?: boolean;
  title?: string;
  url: string;
}

export interface ModelReasoning {
  content?: string;
  duration?: number;
  signature?: string;
}

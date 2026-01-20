import {
  AgentInitErrorPayload,
  ChatCompletionErrorPayload,
  CreateImageErrorPayload,
} from '../types';
import { ILobeAgentRuntimeErrorType } from '../types/error';

export const AgentRuntimeError = {
  chat: (error: ChatCompletionErrorPayload): ChatCompletionErrorPayload => error,
  createError: (
    errorType: ILobeAgentRuntimeErrorType | string | number,
    error?: any,
  ): AgentInitErrorPayload => ({ error, errorType }),
  createImage: (error: CreateImageErrorPayload): CreateImageErrorPayload => error,
};

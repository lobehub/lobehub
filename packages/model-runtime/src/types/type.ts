import type { ModelProvider } from 'model-bank';
import type OpenAI from 'openai';

import type { ChatStreamPayload } from './chat';
import type { ILobeAgentRuntimeErrorType } from './error';

export interface AgentInitErrorPayload {
  error: object;
  errorType: string | number;
}

export interface ChatCompletionErrorPayload {
  [key: string]: any;
  endpoint?: string;
  error: object;
  errorType: ILobeAgentRuntimeErrorType;
  provider: string;
}

export interface CreateImageErrorPayload {
  error: object;
  errorType: ILobeAgentRuntimeErrorType;
  provider: string;
}

export interface CreateChatCompletionOptions {
  chatModel: OpenAI;
  payload: ChatStreamPayload;
}

export type ModelProviderKey = Lowercase<keyof typeof ModelProvider>;

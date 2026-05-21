import type { ModelUsage } from '@lobechat/types';

import type { ChatCompletionTool, ChatStreamPayload } from './chat';

interface GenerateObjectMessage {
  content: string;
  name?: string;
  role: 'user' | 'system' | 'assistant';
}

export interface GenerateObjectSchema {
  description?: string;
  name: string;
  schema: {
    additionalProperties?: boolean;
    properties: Record<string, any>;
    required?: string[];
    type: 'object';
  };
  strict?: boolean;
}

export interface GenerateObjectPayload {
  messages: GenerateObjectMessage[];
  model: string;
  reasoning_effort?: ChatStreamPayload['reasoning_effort'];
  responseApi?: boolean;
  schema?: GenerateObjectSchema;
  thinking?: ChatStreamPayload['thinking'];
  tools?: ChatCompletionTool[];
}

export interface GenerateObjectOptions {
  /**
   * response headers
   */
  headers?: Record<string, any>;

  /** Metadata passed to hooks (billing, tracing, etc.) */
  metadata?: Record<string, unknown>;

  onUsage?: (usage: ModelUsage) => void | Promise<void>;

  signal?: AbortSignal;
  /**
   * userId for the GenerateObject
   */
  user?: string;
}

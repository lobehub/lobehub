import type { LobeAgentChatConfig, OpenAIChatMessage } from '@lobechat/types';
import { z } from 'zod';

// ==================== Chat Service Types ====================

/**
 * Chat service parameters
 */
export interface ChatServiceParams {
  frequency_penalty?: number;
  max_tokens?: number;
  messages: OpenAIChatMessage[];
  model?: string;
  n?: number;
  presence_penalty?: number;
  provider?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
}

export const ChatServiceParamsSchema = z
  .object({
    frequency_penalty: z.number().min(-2).max(2).optional(),
    max_tokens: z.number().int().min(1).max(1_000_000).nullish(),
    messages: z
      .array(
        z.object({
          content: z.string().min(1, 'Message content cannot be empty').max(1_000_000),
          role: z.enum(['user', 'assistant', 'system'], {
            error: 'Role must be user, assistant, or system',
          }),
        }),
      )
      .min(1, 'Message list cannot be empty')
      .max(1000),
    model: z.string().min(1).max(150).nullish(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    provider: z.string().min(1).max(64).nullish(),
    stream: z.boolean().nullish(),
    temperature: z.number().min(0).max(2).nullish(),
    top_p: z.number().min(0).max(1).optional(),
  })
  .refine((value) => value.stream !== true, {
    message: 'Streaming is not supported on /chat; use /responses with stream=true',
    path: ['stream'],
  });

/**
 * Chat response
 */
export interface ChatServiceResponse {
  content: string;
  model?: string;
  provider?: string;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

// ==================== Translation Service Types ====================

/**
 * Translation service parameters
 */
export interface TranslateServiceParams {
  from?: string;
  model?: string;
  provider?: string;
  sessionId?: string | null;
  text: string;
  to: string;
}

export const TranslateServiceParamsSchema = z.object({
  from: z.string().min(1, 'Source language cannot be empty').max(32).optional(),
  model: z.string().min(1).max(150).nullish(),
  provider: z.string().min(1).max(64).nullish(),
  text: z.string().min(1, 'Text to translate cannot be empty').max(1_000_000),
  to: z.string().min(1, 'Target language cannot be empty').max(32),
});

// ==================== Message Generation Types ====================

/**
 * Message generation parameters
 */
export interface MessageGenerationParams {
  agentId?: string;
  chatConfig?: Partial<LobeAgentChatConfig>;
  conversationHistory: Array<{
    content: string;
    role: 'user' | 'assistant' | 'system';
  }>;
  model?: string;
  provider?: string;
  sessionId: string | null;
  userMessage: string;
}

export const MessageGenerationParamsSchema = z.object({
  agentId: z.string().min(1).max(64).nullish(),
  chatConfig: z
    .object({
      disableContextCaching: z.boolean().nullish(),
      displayMode: z.enum(['chat', 'docs']).nullish(),
      enableCompressHistory: z.boolean().nullish(),
      enableHistoryCount: z.boolean().nullish(),
      enableMaxTokens: z.boolean().nullish(),
      enableReasoning: z.boolean().nullish(),
      enableReasoningEffort: z.boolean().nullish(),
      historyCount: z.number().int().min(0).max(1000).nullish(),
      inputTemplate: z.string().max(100_000).nullish(),
      reasoningBudgetToken: z.number().int().min(0).max(1_000_000).nullish(),
      reasoningEffort: z.enum(['low', 'medium', 'high']).nullish(),
      searchMode: z.enum(['off', 'on', 'auto']).nullish(),
      thinkingBudget: z.number().int().min(0).max(1_000_000).nullish(),
      useModelBuiltinSearch: z.boolean().nullish(),
    })
    .nullish(),
  conversationHistory: z
    .array(
      z.object({
        content: z.string().min(1, 'Message content cannot be empty').max(1_000_000),
        role: z.enum(['user', 'assistant', 'system']),
      }),
    )
    .max(1000),
  model: z.string().min(1).max(150).nullish(),
  provider: z.string().min(1).max(64).nullish(),
  sessionId: z.string().min(1).max(64).nullable(),
  userMessage: z.string().min(1).max(1_000_000),
});

// ==================== Configuration Types ====================

/**
 * A hand-written sample of provider ids, kept only because it is exported.
 *
 * It is not the set of providers this service accepts and never was: the
 * request field beside it is `provider?: string`, validated as
 * `z.string().max(64)`, and the runtime resolves whatever id arrives against
 * the `ai_providers` table — including custom providers, which by definition
 * cannot appear in any list written here.
 *
 * @deprecated Provider ids are open. Use `string`.
 */
export type AIProvider = 'openai' | 'anthropic' | 'google' | 'groq' | 'vertexai';

/**
 * Chat Service configuration
 */
export interface ChatServiceConfig {
  defaultModel?: string;
  /**
   * Deliberately `string`, matching `ChatServiceParams['provider']`.
   *
   * Typing this as {@link AIProvider} said a request may name any provider
   * while the default may only be one of five built-ins — a distinction with
   * nothing behind it, since both end up in the same lookup. It also made
   * `DEFAULT_PROVIDER` unassignable: the product's own default is `deepseek`,
   * which that list never included.
   */
  defaultProvider?: string;
  timeout?: number;
}

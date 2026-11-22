import { z } from 'zod';

/**
 * Token source categories of one LLM request, matching `TokenSourceType` in
 * `@lobechat/context-engine` (`countContextTokens`).
 */
export const MESSAGE_CONTEXT_TOKEN_SOURCES = [
  'content',
  'fileContext',
  'toolCalls',
  'thoughtSignature',
  'reasoning',
  'toolCallId',
  'toolDefinition',
] as const;

export type MessageContextTokenSource = (typeof MESSAGE_CONTEXT_TOKEN_SOURCES)[number];

/**
 * Estimated input-token accounting of the request that produced an assistant
 * message, computed by the agent runtime from the final request payload
 * (processed messages plus the `tools` array actually sent).
 *
 * The counts come from the `tokenx` heuristic, not the provider tokenizer:
 * read them as an estimate of what the request contained, never as billing.
 */
export interface MessageContextAccounting {
  /**
   * Non-system messages and the `tools` array, split by source. Tool results
   * count under `content`; `<files_info>` attachment blocks under `fileContext`.
   */
  bySource: Record<MessageContextTokenSource, number>;
  /** Estimator behind the counts. */
  estimator: 'tokenx';
  /** Number of messages in the request, system messages included. */
  messageCount: number;
  /**
   * System messages: the agent system role plus everything the context engine
   * injects there (tool prompts, memory, history summary, …).
   */
  system: number;
  /** `system` plus every `bySource` value. */
  total: number;
}

// Lenient on purpose: client writes echo stored metadata back through this
// schema, so a value written by an older or newer runtime is coerced instead
// of failing the whole write.
const tokens = z.number().catch(0);

export const MessageContextAccountingSchema = z.object({
  bySource: z
    .object({
      content: tokens,
      fileContext: tokens,
      reasoning: tokens,
      thoughtSignature: tokens,
      toolCallId: tokens,
      toolCalls: tokens,
      toolDefinition: tokens,
    })
    .catch({
      content: 0,
      fileContext: 0,
      reasoning: 0,
      thoughtSignature: 0,
      toolCallId: 0,
      toolCalls: 0,
      toolDefinition: 0,
    }),
  estimator: z.literal('tokenx').catch('tokenx'),
  messageCount: tokens,
  system: tokens,
  total: tokens,
});

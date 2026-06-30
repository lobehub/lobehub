import { AgentRuntimeErrorType } from '@lobechat/types';

/**
 * Thrown when the model returns an empty completion — no text content, no
 * reasoning, no tool calls, no images, and ~0 output tokens. This is the "empty
 * completion" failure mode: after a stalled tool loop the model effectively
 * gives up and emits a blank turn, which the harness used to silently finalize
 * to `done` while persisting an empty assistant message (empty bubble,
 * `status=done, error=null`).
 *
 * The `errorType` field tags it as the retryable `ModelEmptyCompletion` code
 * (see `errors/specs.ts`, which classifies it as a retryable `provider` error)
 * so that:
 *   1. an LLM-error classifier resolves it to `retry`, letting the agent's
 *      `call_llm` retry loop re-attempt the turn (a retry typically yields real
 *      content).
 *   2. If every retry is also empty, the terminal-error formatter enriches it
 *      into a readable, dashboard-visible error instead of a silent `done`.
 */
export class ModelEmptyError extends Error {
  readonly errorType = AgentRuntimeErrorType.ModelEmptyCompletion;

  constructor(
    message = 'Model returned an empty completion (no content, no tool calls, no output tokens).',
  ) {
    super(message);
    this.name = 'ModelEmptyError';
  }
}

/**
 * Output-token count at or below this — combined with no content, reasoning,
 * tool calls, or images — marks a turn as an empty completion.
 * The observed failure case reported `out=1 token`.
 */
const EMPTY_COMPLETION_MAX_OUTPUT_TOKENS = 1;

/**
 * Detect the "empty completion" failure mode: the model returns a turn with no
 * text, no reasoning, no tool calls, no images, and ~0 output tokens —
 * typically after a stalled tool loop where it effectively gives up. Callers
 * throw {@link ModelEmptyError} on a hit so the LLM retry loop re-attempts
 * instead of silently finalizing to `done` with a blank assistant message.
 */
export const isEmptyModelCompletion = (params: {
  content: string;
  imageCount: number;
  outputTokens: number | undefined;
  reasoning: string;
  toolCallCount: number;
}): boolean => {
  const { content, reasoning, toolCallCount, imageCount, outputTokens } = params;

  if (content.trim().length > 0) return false;
  if (reasoning.trim().length > 0) return false;
  if (toolCallCount > 0) return false;
  if (imageCount > 0) return false;

  // When the provider reports output tokens, only treat as empty if it's ~0.
  // Guards against rare cases where structured output we don't accumulate into
  // `content`/`reasoning` here (e.g. grounding) still consumed real tokens.
  if (typeof outputTokens === 'number' && outputTokens > EMPTY_COMPLETION_MAX_OUTPUT_TOKENS) {
    return false;
  }

  return true;
};

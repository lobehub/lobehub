import { AgentRuntimeErrorType } from '@lobechat/types';

export interface ModelEmptyCompletionDiagnostics {
  attempt?: number;
  contentLength?: number;
  finishReason?: string;
  imageCount?: number;
  maxAttempts?: number;
  model?: string;
  outputTokens?: number;
  provider?: string;
  reasoningLength?: number;
  retryBudget?: number;
  retryEvents?: Array<Record<string, unknown>>;
  toolCallCount?: number;
}

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
  readonly diagnostics?: ModelEmptyCompletionDiagnostics;

  constructor(
    message = 'Model returned an empty completion (no content, no tool calls, no output tokens).',
    diagnostics?: ModelEmptyCompletionDiagnostics,
  ) {
    super(message);
    this.name = 'ModelEmptyError';
    this.diagnostics = diagnostics;
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
  hasGrounding?: boolean;
  imageCount: number;
  outputTokens: number | undefined;
  reasoning: string;
  toolCallCount: number;
}): boolean => {
  const { content, reasoning, toolCallCount, imageCount, outputTokens, hasGrounding } = params;

  if (content.trim().length > 0) return false;
  if (reasoning.trim().length > 0) return false;
  if (toolCallCount > 0) return false;
  if (imageCount > 0) return false;

  // A turn can legitimately burn output tokens without producing any text we
  // accumulate into `content`/`reasoning` — grounding/citation metadata is the
  // known case. Only *that* signal justifies treating a positive token count as
  // a non-empty completion.
  //
  // A high output-token count WITHOUT such a signal is not proof of a real
  // reply — it means the model generated text we failed to capture (e.g. a
  // post-tool answer turn whose streamed content was dropped by the sink). If we
  // trusted the token count there, we would silently finalize to `done` with a
  // blank assistant message the user still gets billed for. So we only take the
  // token escape hatch when a real no-text output signal is present; otherwise
  // fall through to `empty` and let the caller retry.
  if (
    hasGrounding &&
    typeof outputTokens === 'number' &&
    outputTokens > EMPTY_COMPLETION_MAX_OUTPUT_TOKENS
  ) {
    return false;
  }

  return true;
};

import { AgentRuntimeErrorType } from '@lobechat/types';

/**
 * Thrown by the `call_llm` executor when the model returns an empty completion
 * — no text content, no reasoning, no tool calls, no images, and ~0 output
 * tokens. This is the "empty completion" failure mode: after a stalled tool loop the
 * model effectively gives up and emits a blank turn, which the harness used to
 * silently finalize to `done` while persisting an empty assistant message
 * (empty bubble, `status=done, error=null`).
 *
 * The `errorType` field tags it as the retryable `ModelEmptyCompletion` code so
 * that:
 *   1. `classifyLLMError` resolves it to `retry`, letting the executor's LLM
 *      retry loop re-attempt the turn (a retry typically yields real content).
 *   2. If every retry is also empty, `formatErrorForState` enriches it into a
 *      readable, dashboard-visible terminal error instead of a silent `done`.
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

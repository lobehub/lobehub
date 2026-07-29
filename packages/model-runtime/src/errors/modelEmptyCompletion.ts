import { AgentRuntimeErrorType } from '@lobechat/types';

export interface ModelEmptyCompletionDiagnostics {
  attempt?: number;
  contentLength?: number;
  /** Calculated request cost in USD when pricing and usage are available. */
  cost?: number;
  finishReason?: string;
  imageCount?: number;
  maxAttempts?: number;
  model?: string;
  outputTokens?: number;
  provider?: string;
  reasoningLength?: number;
  toolCallCount?: number;
}

/**
 * Thrown when the provider completes a request without user-visible content,
 * reasoning, tool calls, images, or grounding. Provider-reported output usage
 * does not make an otherwise blank turn visible to the user.
 *
 * The `errorType` tags this as the terminal `ModelEmptyCompletion` provider
 * error. Callers surface it immediately so the user can decide whether another
 * potentially billable request should be made.
 */
export class ModelEmptyError extends Error {
  readonly errorType = AgentRuntimeErrorType.ModelEmptyCompletion;
  readonly diagnostics?: ModelEmptyCompletionDiagnostics;

  constructor(
    message = 'The model provider returned an empty completion.',
    diagnostics?: ModelEmptyCompletionDiagnostics,
  ) {
    super(message);
    this.name = 'ModelEmptyError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Grounding is a valid non-text result only when the provider also reports
 * meaningful output usage.
 */
const EMPTY_COMPLETION_MAX_OUTPUT_TOKENS = 1;

/**
 * Detect a completion with no user-visible output. Callers throw
 * {@link ModelEmptyError} so the blank turn surfaces as a terminal provider
 * error instead of silently finalizing as a successful assistant message.
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

  // Grounding/citation metadata is a known valid no-text result. In every other
  // case, provider-reported output tokens may represent internal reasoning or
  // other billable work, but they do not give the user a visible completion.
  if (
    hasGrounding &&
    typeof outputTokens === 'number' &&
    outputTokens > EMPTY_COMPLETION_MAX_OUTPUT_TOKENS
  ) {
    return false;
  }

  return true;
};

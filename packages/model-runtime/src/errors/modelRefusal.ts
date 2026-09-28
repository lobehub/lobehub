import { AgentRuntimeErrorType } from '@lobechat/types';

import type { ModelEmptyCompletionDiagnostics } from './modelEmptyCompletion';

export type ModelRefusalDiagnostics = ModelEmptyCompletionDiagnostics;

/**
 * Terminal finish reasons that mean the provider declined to answer or blocked the output.
 * - `refusal`: Anthropic (and OpenAI-compatible proxies relaying it)
 * - `content_filter`: OpenAI / Azure OpenAI
 * - `sensitive`: Zhipu GLM
 * - `safety`, `prohibited_content`, `blocklist`, `spii`: Google Gemini / Vertex AI
 *
 * `recitation` is excluded: it is a copyright stop, not a policy refusal of the request.
 */
const MODEL_REFUSAL_FINISH_REASONS = new Set([
  'blocklist',
  'content_filter',
  'prohibited_content',
  'refusal',
  'safety',
  'sensitive',
  'spii',
]);

export const isModelRefusalFinishReason = (finishReason?: string | null): boolean =>
  Boolean(finishReason && MODEL_REFUSAL_FINISH_REASONS.has(finishReason.toLowerCase()));

/**
 * Thrown when the provider explicitly refuses an otherwise empty completion.
 * Refusals with user-visible text remain normal completions so the provider's
 * explanation is not discarded.
 */
export class ModelRefusalError extends Error {
  readonly errorType = AgentRuntimeErrorType.ModelRefusal;
  readonly diagnostics?: ModelRefusalDiagnostics;

  constructor(
    message = 'The model declined to answer this request.',
    diagnostics?: ModelRefusalDiagnostics,
  ) {
    super(message);
    this.name = 'ModelRefusalError';
    this.diagnostics = diagnostics;
  }
}

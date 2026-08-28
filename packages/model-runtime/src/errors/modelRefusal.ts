import { AgentRuntimeErrorType } from '@lobechat/types';

import type { ModelEmptyCompletionDiagnostics } from './modelEmptyCompletion';

export type ModelRefusalDiagnostics = ModelEmptyCompletionDiagnostics;

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

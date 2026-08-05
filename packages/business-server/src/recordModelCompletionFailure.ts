export type ModelCompletionFailureReason = 'empty_completion' | 'refusal';

export interface ModelCompletionFailureRuntimeEvidence {
  provider?: unknown;
  route?: unknown;
}

export interface RecordModelCompletionFailureParams {
  attempt: number;
  maxAttempts: number;
  model: string;
  operationId: string;
  operationLogId: string;
  provider: string;
  reason: ModelCompletionFailureReason;
  /**
   * The model payload only. Provider credentials and transport headers are
   * deliberately not accepted by this hook.
   */
  request: unknown;
  /** Full normalized completion output and callback evidence. */
  response: unknown;
  /** Provider-boundary and route evidence captured for this exact call. */
  runtime?: ModelCompletionFailureRuntimeEvidence;
  stepIndex: number;
  topicId?: string;
  trigger?: unknown;
  userId?: string;
  workspaceId?: string;
}

export const recordModelCompletionFailure = async (
  _params: RecordModelCompletionFailureParams,
): Promise<void> => {};

export type ModelCompletionFailureReason = 'empty_completion' | 'refusal';

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
  stepIndex: number;
  topicId?: string;
  trigger?: unknown;
  userId?: string;
  workspaceId?: string;
}

export const recordModelCompletionFailure = async (
  _params: RecordModelCompletionFailureParams,
): Promise<void> => {};

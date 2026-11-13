/**
 * The step lock was lost, or could not be confirmed, before this attempt
 * committed the step. It says nothing about the run, only that this attempt
 * must not commit: `failStep` rethrows it untouched, so the queue redelivers
 * the step and its claim decides who runs it.
 */
/**
 * The durable operation row could not be read, so this delivery cannot tell
 * whether the run still belongs to it. The step refuses to run and must not
 * settle the run either: the queue redelivers it and the next attempt re-checks.
 */
export class DurableStatusUnavailableError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly stepIndex: number,
    options?: { cause?: unknown },
  ) {
    super(
      `Durable status of operation ${operationId} is unavailable at step ${stepIndex}`,
      options,
    );
    this.name = 'DurableStatusUnavailableError';
  }
}

export class StepOwnershipLostError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly stepIndex: number,
    options?: { cause?: unknown },
  ) {
    super(`Step ${stepIndex} of operation ${operationId} lost its lock before commit`, options);
    this.name = 'StepOwnershipLostError';
  }
}

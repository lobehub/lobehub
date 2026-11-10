/**
 * The step lock was lost, or could not be confirmed, before this attempt
 * committed the step. It says nothing about the run, only that this attempt
 * must not commit: `failStep` rethrows it untouched, so the queue redelivers
 * the step and its claim decides who runs it.
 */
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

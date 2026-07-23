export const AGENT_STEP_TIMEOUT_ERROR_TYPE = 'AgentStepTimeout';

export const DEFAULT_AGENT_STEP_DEADLINE_MS = 8 * 60 * 1000;

interface AgentStepTimeoutErrorOptions {
  deadlineAt: number;
  stage: string;
  stageElapsedMs?: number;
}

export class AgentStepTimeoutError extends Error {
  readonly deadlineAt: number;
  readonly errorType = AGENT_STEP_TIMEOUT_ERROR_TYPE;
  handled = false;
  readonly stage: string;
  readonly stageElapsedMs?: number;

  constructor({ deadlineAt, stage, stageElapsedMs }: AgentStepTimeoutErrorOptions) {
    super(`Agent step exceeded its deadline while in stage: ${stage}`);
    this.name = AGENT_STEP_TIMEOUT_ERROR_TYPE;
    this.deadlineAt = deadlineAt;
    this.stage = stage;
    this.stageElapsedMs = stageElapsedMs;
  }
}

export const isAgentStepTimeoutError = (error: unknown): error is AgentStepTimeoutError =>
  error instanceof AgentStepTimeoutError ||
  (typeof error === 'object' &&
    error !== null &&
    'errorType' in error &&
    error.errorType === AGENT_STEP_TIMEOUT_ERROR_TYPE);

export const markAgentStepTimeoutHandled = (error: AgentStepTimeoutError): void => {
  error.handled = true;
};

export const getAgentStepAbortReason = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason;

  return new Error(typeof signal.reason === 'string' ? signal.reason : 'Agent step aborted');
};

/**
 * Preserve the exact abort reason instance rather than normalizing it through
 * agentRuntime/abort.ts. The timeout instance is marked as handled only after
 * its terminal state is durable, and the HTTP boundary reads that same marker
 * to choose between QStash ACK and retry.
 */
export const throwIfAgentStepAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;

  throw getAgentStepAbortReason(signal);
};

export const raceWithAgentStepSignal = async <T>(
  promise: PromiseLike<T> | T,
  signal?: AbortSignal,
): Promise<T> => {
  const pending = Promise.resolve(promise);
  if (!signal) return pending;

  throwIfAgentStepAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(getAgentStepAbortReason(signal));
    signal.addEventListener('abort', handleAbort, { once: true });

    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', handleAbort);
    });
  });
};

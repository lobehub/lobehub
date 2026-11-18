import { AgentRuntimeErrorType } from '@lobechat/model-runtime';

import { AsyncTaskError, AsyncTaskErrorType } from '@/types/asyncTask';

const MAX_NESTED_ERROR_DEPTH = 3;

/**
 * Runtime errors are `{ errorType, error: { message, ... } }` payloads, sometimes nested one
 * more level by router runtimes; plain `Error`s carry `message` directly.
 */
const readErrorMessage = (error: unknown): string | undefined => {
  let current = error;
  for (let depth = 0; depth <= MAX_NESTED_ERROR_DEPTH; depth++) {
    if (!current || typeof current !== 'object')
      return typeof current === 'string' ? current : undefined;

    const record = current as { error?: unknown; message?: unknown };
    if (typeof record.message === 'string' && record.message) return record.message;
    current = record.error;
  }
};

const readErrorType = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return;
  const { errorType } = error as { errorType?: unknown };
  return typeof errorType === 'string' ? errorType : undefined;
};

export type MusicTaskStage = 'process' | 'submit';

/**
 * Turn a music generation failure into the error stored on its async tasks.
 *
 * Credential and moderation failures keep their own types so the client can tell the user to
 * fix the key or the prompt; anything else is a trigger error (the provider refused the
 * submission) or a server error (polling or storing the result failed).
 */
export const createMusicTaskError = (
  error: unknown,
  stage: MusicTaskStage,
  providerContentPolicyMessage?: string,
) => {
  if (providerContentPolicyMessage)
    return new AsyncTaskError(
      AsyncTaskErrorType.ProviderContentModeration,
      providerContentPolicyMessage,
    );

  const errorType = readErrorType(error);
  const message = readErrorMessage(error) || errorType || 'Unknown error';

  switch (errorType) {
    case AgentRuntimeErrorType.InvalidProviderAPIKey: {
      return new AsyncTaskError(AsyncTaskErrorType.InvalidProviderAPIKey, message);
    }
    case AgentRuntimeErrorType.ContentModeration: {
      return new AsyncTaskError(AsyncTaskErrorType.ProviderContentModeration, message);
    }
  }

  if (error instanceof Error && error.name === 'AbortError')
    return new AsyncTaskError(AsyncTaskErrorType.Timeout, 'Music generation timed out');

  return stage === 'submit'
    ? new AsyncTaskError(
        AsyncTaskErrorType.TaskTriggerError,
        `Failed to submit music task: ${message}`,
      )
    : new AsyncTaskError(AsyncTaskErrorType.ServerError, `Music generation failed: ${message}`);
};

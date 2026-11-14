import { isImageDecodingRequestError, shouldStopFallbackForError } from '../../utils/routeFallback';

/** Whether a failed attempt may fall back to the next channel, and why not when it may not. */
export const classifyAttemptError = (error: unknown) => {
  const nonRetryable = shouldStopFallbackForError(error);
  const nonRetryableReason =
    nonRetryable && isImageDecodingRequestError(error) ? ('imageDecode' as const) : undefined;

  return { nonRetryable, nonRetryableReason };
};

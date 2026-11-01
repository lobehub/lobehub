import { toRecord } from '@lobechat/utils/object';

/**
 * Marks a failed device tool call as never-replayable.
 *
 * A device result carries its failure as a plain string, so the tool error
 * classifier falls back to keyword matching: "timed out" in a gateway timeout,
 * or in a command's own stderr, classifies as `retry` and the transport silently
 * re-sends the call. The device may already be running the first copy (it was
 * asleep, or slow to answer), so a single `echo >> file` ran three times and the
 * user waited three full timeouts — while the model was told not to repeat
 * anything blindly. Whether and how to retry is the model's call; the content
 * already explains which failures are safe to retry.
 */
export const withoutDeviceReplay = <
  T extends { error?: unknown; errorData?: unknown; success?: boolean },
>(
  result: T,
): T => {
  if (result.success) return result;

  const error =
    typeof result.error === 'string' ? { message: result.error } : toRecord(result.error);
  const errorData = toRecord(result.errorData);

  return {
    ...result,
    error: { ...error, kind: 'stop' },
    // `errorData` wins over `error` when the executor classifies the failure.
    ...(errorData && { errorData: { ...errorData, kind: 'stop' } }),
  };
};

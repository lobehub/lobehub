import { AgentRuntimeErrorType } from '@lobechat/types';

import type { ChatCompletionErrorPayload } from '../types';
import type { MusicPollingOptions, MusicTrack, PollMusicStatusResult } from '../types/music';
import { AgentRuntimeError } from './createError';

export const DEFAULT_MUSIC_POLL_INTERVAL_MS = 5000;
export const DEFAULT_MUSIC_POLL_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_MUSIC_POLL_MAX_ATTEMPTS = 120;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Poll an asynchronous music task until it succeeds, fails, or exceeds its time / attempt
 * budget. Failures and timeouts are thrown as runtime error payloads so callers see the
 * same `AgentRuntimeErrorType` contract as the synchronous providers.
 */
export const waitForMusicCompletion = async (
  poll: () => Promise<PollMusicStatusResult>,
  {
    maxAttempts = DEFAULT_MUSIC_POLL_MAX_ATTEMPTS,
    pollIntervalMs = DEFAULT_MUSIC_POLL_INTERVAL_MS,
    provider,
    signal,
    taskId,
    timeoutMs = DEFAULT_MUSIC_POLL_TIMEOUT_MS,
  }: MusicPollingOptions & { provider: string; signal?: AbortSignal; taskId: string },
): Promise<MusicTrack[]> => {
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await poll();

    if (result.status === 'success') return result.tracks;

    if (result.status === 'failed') {
      throw AgentRuntimeError.chat({
        error: { message: result.error, taskId },
        errorType: result.errorType,
        provider,
      } satisfies ChatCompletionErrorPayload);
    }

    if (attempt === maxAttempts || Date.now() + pollIntervalMs > deadline) break;

    await sleep(pollIntervalMs, signal);
  }

  throw AgentRuntimeError.chat({
    error: {
      maxAttempts,
      message: `Music generation did not finish within ${timeoutMs}ms / ${maxAttempts} polls`,
      taskId,
      timeoutMs,
    },
    errorType: AgentRuntimeErrorType.ProviderNetworkError,
    provider,
  } satisfies ChatCompletionErrorPayload);
};

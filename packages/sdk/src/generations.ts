import { Generations } from './generated/sdk.gen';
import type { Generation } from './generated/types.gen';

/** Statuses after which a generation no longer changes. */
export const TERMINAL_GENERATION_STATUSES: readonly Generation['status'][] = ['success', 'error'];

export const DEFAULT_GENERATION_POLL_INTERVAL = 2000;
export const DEFAULT_GENERATION_WAIT_TIMEOUT = 10 * 60 * 1000;

export interface GenerationWaitOptions {
  /** Called with every state read, e.g. to report progress. */
  onPoll?: (generation: Generation) => void;
  /** Milliseconds between status reads. Defaults to 2 s. */
  pollInterval?: number;
  /** Stops waiting (rejecting with the signal's reason) when aborted. */
  signal?: AbortSignal;
  /**
   * Give up after this many milliseconds, including a status request still in
   * flight. Defaults to 10 minutes; videos can take several.
   */
  timeout?: number;
}

/**
 * `generations.wait` ran out of time; `generation` is the last state it read
 * (absent when no status request finished in time).
 */
export class GenerationWaitTimeoutError extends Error {
  readonly generation?: Generation;
  readonly timeout: number;

  constructor(id: string, timeout: number, generation?: Generation) {
    super(
      `Generation ${id} is still ${generation?.status ?? 'unread'} after ${timeout} ms; call generations.wait again to keep waiting`,
    );
    this.name = 'GenerationWaitTimeoutError';
    this.generation = generation;
    this.timeout = timeout;
  }
}

/** Abort when any of `signals` does (`AbortSignal.any`, with a fallback for older hosts). */
const anySignal = (signals: AbortSignal[]) => {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
      signal: controller.signal,
    });
  }
  return controller.signal;
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** `lobehub.generations`, plus `wait()` to poll a generation until it is final. */
export class GenerationsResource extends Generations {
  /**
   * Poll `GET /generations/{id}` until the generation succeeded or failed, and
   * return its final state. A failed generation resolves too — check `status`
   * (and `error`). Request errors (404, 403, …) reject with `LobeHubAPIError`;
   * running out of `timeout` rejects with `GenerationWaitTimeoutError`.
   *
   * ```ts
   * const { data } = await lobehub.videos.generate({ body: { model, prompt, provider } });
   * const video = await lobehub.generations.wait(data!.data.generations[0].id);
   * if (video.status === 'success') console.log(video.asset?.url);
   * ```
   */
  async wait(id: string, options: GenerationWaitOptions = {}): Promise<Generation> {
    const {
      onPoll,
      pollInterval = DEFAULT_GENERATION_POLL_INTERVAL,
      signal,
      timeout = DEFAULT_GENERATION_WAIT_TIMEOUT,
    } = options;
    const deadline = Date.now() + timeout;
    // The deadline also aborts a status request in flight (and its retries),
    // so a slow or stalled request cannot outlive `timeout`.
    const expiry = new AbortController();
    const timer = setTimeout(() => expiry.abort(), timeout);
    const waitSignal = signal ? anySignal([signal, expiry.signal]) : expiry.signal;
    let last: Generation | undefined;

    try {
      for (;;) {
        const { data } = await this.get({
          path: { id },
          signal: waitSignal,
          throwOnError: true,
          timeout: Math.max(1, deadline - Date.now()),
        });
        last = data.data;
        onPoll?.(last);
        if (TERMINAL_GENERATION_STATUSES.includes(last.status)) return last;

        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new GenerationWaitTimeoutError(id, timeout, last);
        await sleep(Math.min(pollInterval, remaining), waitSignal);
      }
    } catch (error) {
      // A caller's own abort keeps its reason; running out of time is a timeout.
      if (!signal?.aborted && (expiry.signal.aborted || Date.now() >= deadline)) {
        if (error instanceof GenerationWaitTimeoutError) throw error;
        throw new GenerationWaitTimeoutError(id, timeout, last);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

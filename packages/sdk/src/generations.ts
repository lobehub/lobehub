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
  /** Give up after this many milliseconds. Defaults to 10 minutes; videos can take several. */
  timeout?: number;
}

/** `generations.wait` ran out of time; `generation` is the last state it read. */
export class GenerationWaitTimeoutError extends Error {
  readonly generation: Generation;
  readonly timeout: number;

  constructor(generation: Generation, timeout: number) {
    super(
      `Generation ${generation.id} is still ${generation.status} after ${timeout} ms; call generations.wait again to keep waiting`,
    );
    this.name = 'GenerationWaitTimeoutError';
    this.generation = generation;
    this.timeout = timeout;
  }
}

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

    for (;;) {
      const { data } = await this.get({ path: { id }, signal, throwOnError: true });
      const generation = data.data;
      onPoll?.(generation);
      if (TERMINAL_GENERATION_STATUSES.includes(generation.status)) return generation;

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new GenerationWaitTimeoutError(generation, timeout);
      await sleep(Math.min(pollInterval, remaining), signal);
    }
  }
}

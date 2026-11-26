import { AsyncLocalStorage } from 'node:async_hooks';

const deadlineStorage = new AsyncLocalStorage<number>();

/**
 * Run `fn` knowing the host kills this invocation at `deadlineAt` (epoch ms),
 * so long waits inside it can stop in time to clean up after themselves.
 */
export const runWithInvocationDeadline = <T>(deadlineAt: number, fn: () => Promise<T>) =>
  deadlineStorage.run(deadlineAt, fn);

/** When the current invocation is killed, if its host declared it. */
export const getInvocationDeadline = (): number | undefined => deadlineStorage.getStore();

const INVOCATION_DEADLINE_ERROR_NAME = 'InvocationDeadlineError';

/**
 * Abort reason of a signal from {@link createInvocationDeadlineSignal}: work was
 * stopped because the host was about to kill the invocation, not because a
 * user or caller asked for it.
 */
export class InvocationDeadlineError extends Error {
  constructor(public readonly deadlineAt: number) {
    super('Stopped before the invocation deadline');
    this.name = INVOCATION_DEADLINE_ERROR_NAME;
  }
}

/**
 * Whether `signal` was aborted by an invocation deadline. Compared by name so
 * the check still holds when the error class is loaded twice (Cloud overrides).
 */
export const isInvocationDeadlineAbort = (signal: AbortSignal | null | undefined): boolean =>
  !!signal?.aborted &&
  (signal.reason as { name?: unknown } | undefined)?.name === INVOCATION_DEADLINE_ERROR_NAME;

export interface InvocationDeadlineSignal {
  /** Clear the timer; call once the guarded work settles. */
  dispose: () => void;
  signal: AbortSignal;
}

/**
 * A signal that aborts `marginMs` before the current invocation is killed, so
 * the guarded work can still finalize and persist what it produced.
 * `undefined` when no host declared a deadline.
 *
 * The timer never fires sooner than `minMs` from now: work that starts late
 * still gets a short, bounded chance instead of failing on the spot.
 */
export const createInvocationDeadlineSignal = ({
  marginMs,
  minMs,
  now = Date.now(),
}: {
  marginMs: number;
  minMs: number;
  now?: number;
}): InvocationDeadlineSignal | undefined => {
  const deadlineAt = getInvocationDeadline();
  if (deadlineAt === undefined) return;

  const controller = new AbortController();
  const delayMs = Math.max(minMs, deadlineAt - now - marginMs);
  const timer = setTimeout(
    () => controller.abort(new InvocationDeadlineError(deadlineAt)),
    delayMs,
  );

  return {
    dispose: () => clearTimeout(timer),
    signal: controller.signal,
  };
};

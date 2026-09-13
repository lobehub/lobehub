import { AsyncLocalStorage } from 'node:async_hooks';

import debug from 'debug';

const log = debug('lobe-server:schedule-after-response');

export type ScheduleAfterResponseWork = () => Promise<unknown> | unknown;

const runWork = async (work: ScheduleAfterResponseWork) => {
  try {
    await work();
  } catch (error) {
    log('Scheduled work threw: %O', error);
  }
};

/**
 * Hand work to the host so it runs after the HTTP response is sent. Falls back
 * to running it immediately when there is no host that supports this.
 */
const scheduleOnHost = (work: () => Promise<void>): void => {
  try {
    const nextServer = require('next/server') as {
      after?: (work: () => Promise<void>) => void;
    };

    if (typeof nextServer.after === 'function') {
      try {
        nextServer.after(work);
        return;
      } catch (error) {
        log('next/server after() unavailable, falling back: %O', error);
      }
    }
  } catch {
    // next/server is not available in standalone Hono.
  }

  void work();
};

interface ScheduledWorkScope {
  pending: Set<Promise<void>>;
}

const scopeStorage = new AsyncLocalStorage<ScheduledWorkScope>();

const drain = async (scope: ScheduledWorkScope) => {
  // Loop, because finished work may have scheduled more.
  while (scope.pending.size > 0) {
    await Promise.allSettled(scope.pending);
  }
};

export const after = (work: ScheduleAfterResponseWork): void => {
  const scope = scopeStorage.getStore();

  if (scope) {
    const task = runWork(work);
    scope.pending.add(task);
    void task.finally(() => scope.pending.delete(task));
    return;
  }

  scheduleOnHost(() => runWork(work));
};

/**
 * Run `fn` so that work it defers with {@link after} starts immediately and can
 * be awaited with {@link flushScheduledWork}, instead of waiting for the HTTP
 * response.
 *
 * Use when:
 * - One request performs several independent units of work back to back, and
 *   what one unit defers must be done before the next unit starts — e.g. the
 *   agent step loop, where each step's budget settlement has to release its
 *   hold before the next step reserves again.
 *
 * Deferred work is only captured while the async context propagates from
 * `fn`. Anything scheduled outside it keeps the ordinary post-response
 * behaviour. Node binds that context where a stream is created, so work
 * deferred from a stream callback (for example a model response's `onFinal`)
 * is captured only when the stream itself is created inside the scope. Work still running when `fn` settles is handed to the host, so
 * returning from the scope never waits for it.
 */
export const runWithScheduledWorkScope = async <T>(fn: () => Promise<T>): Promise<T> => {
  const scope: ScheduledWorkScope = { pending: new Set() };

  try {
    return await scopeStorage.run(scope, fn);
  } finally {
    if (scope.pending.size > 0) scheduleOnHost(() => drain(scope));
  }
};

/**
 * Wait for work deferred inside the current {@link runWithScheduledWorkScope}.
 * A no-op outside a scope.
 *
 * With `timeoutMs`, stops waiting after that long and lets the remaining work
 * keep running, so one stuck telemetry call cannot stall the caller.
 */
export const flushScheduledWork = async ({
  timeoutMs,
}: { timeoutMs?: number } = {}): Promise<void> => {
  const scope = scopeStorage.getStore();
  if (!scope || scope.pending.size === 0) return;

  const drained = drain(scope);
  if (timeoutMs === undefined) return drained;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  const outcome = await Promise.race([drained.then(() => 'drained' as const), timedOut]);
  clearTimeout(timer);

  if (outcome === 'timeout') {
    log('Stopped waiting for %d scheduled task(s) after %dms', scope.pending.size, timeoutMs);
  }
};

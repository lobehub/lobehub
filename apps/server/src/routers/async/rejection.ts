import { TRPCClientError } from '@trpc/client';

import { afterUnscoped } from '@/server/utils/scheduleAfterResponse';

/**
 * The async router refused the call in its auth middleware (for example, an internal
 * JWT that expired while the async function cold-started), so the procedure never ran
 * and nothing else will update the task. Other request failures (a proxy timing out a
 * long generation, a dropped connection) may come from a procedure that is still running.
 */
export const isAsyncCallRejectedBeforeRun = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';

/**
 * How long the submitting request stays alive after its response to hear back from the
 * async router. A refusal arrives once the async function has cold-started, well within
 * this window; a call still pending after it is running the generation itself.
 */
export const ASYNC_REJECTION_WINDOW_MS = 30_000;

/**
 * Keep the request alive so a fire-and-forget async call's failure handling (failing the
 * task, refunding the precharge) still runs on hosts that freeze unawaited work after the
 * response, such as Vercel.
 *
 * Only the wait for the call is bounded by {@link ASYNC_REJECTION_WINDOW_MS}: waiting for
 * the whole call would hold the request for the full generation (up to the async task
 * timeout). Once the call settles inside the window, `handled` runs to completion, so a
 * refund that starts near the end of the window is not cut off. The unscoped hand-off
 * keeps this wait off the agent step loop's scheduled-work flush.
 *
 * @param call The raw async call.
 * @param handled `call` with its failure handling attached.
 */
export const keepAliveForAsyncRejection = (call: Promise<unknown>, handled: Promise<unknown>) => {
  afterUnscoped(async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const windowEnd = new Promise<'window'>((resolve) => {
      timer = setTimeout(() => resolve('window'), ASYNC_REJECTION_WINDOW_MS);
    });
    const settled = call.then(
      () => 'settled' as const,
      () => 'settled' as const,
    );

    const outcome = await Promise.race([settled, windowEnd]);
    clearTimeout(timer);

    if (outcome === 'settled') await handled;
  });
};

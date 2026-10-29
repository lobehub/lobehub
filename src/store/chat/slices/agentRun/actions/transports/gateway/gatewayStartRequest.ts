import { aiAgentService } from '@/services/aiAgent';

/**
 * Interrupts a gateway operation and rejects when its physical shutdown is unconfirmed.
 *
 * Device confirmation is authoritative for local heterogeneous agents because
 * their server runtime may already be absent while the native process still
 * needs to release its writer. Other runtimes fall back to the service result.
 */
export const interruptGatewayTaskOrThrow = async (
  params: Parameters<typeof aiAgentService.interruptTask>[0],
): Promise<void> => {
  const result = await aiAgentService.interruptTask(params);
  const cancellationConfirmed = result.deviceCancellationConfirmed ?? result.success;

  if (!cancellationConfirmed) {
    throw new Error(
      `Gateway operation ${params.operationId ?? 'unknown'} cancellation unconfirmed`,
    );
  }
};

/**
 * Waits for a server start request while honoring a caller abort locally.
 *
 * Use when:
 * - The ChatInput Stop can fire while `execAgentTask` is still in flight.
 *
 * Expects:
 * - `request` was issued WITHOUT the abort signal. Aborting the fetch only
 *   drops the response: the server still persists the turn and dispatches the
 *   run (for a connected device, it spawns the native CLI), and the client
 *   would never learn the operation id needed to stop it.
 *
 * Returns:
 * - The server result, or rejects with an AbortError as soon as the caller
 *   aborts. After such an abort, `onAbandoned` receives the result the server
 *   eventually returns so the caller can interrupt that orphaned run.
 */
export const awaitStartRequest = <T>(
  request: Promise<T>,
  signal: AbortSignal | undefined,
  onAbandoned: (result: T) => Promise<unknown>,
): Promise<T> => {
  if (!signal) return request;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('Message send was cancelled', 'AbortError'));
      request
        .then(onAbandoned)
        .catch((error) => console.error('[Gateway] interrupt after aborted start failed:', error));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request.then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

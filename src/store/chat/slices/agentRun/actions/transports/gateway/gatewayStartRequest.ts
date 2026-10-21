import { aiAgentService } from '@/services/aiAgent';
import { shareChatService } from '@/services/shareChat';

import { freezeGatewayRunForStop, unfreezeGatewayRunForStop } from './stopFreeze';

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
 * Forwards a composer Stop to the server with the reply text frozen on screen,
 * so the server trims its saved reply to it (LOBE-14836).
 *
 * Returns:
 * - `true` once an owner run's shutdown is confirmed; the caller then settles
 *   the owner-side queue and topic.
 * - `false` for a share visitor's run, which has none of that state.
 * - Rejects, with the reply rendering again, when the shutdown is unconfirmed.
 */
export const interruptGatewayRunOnStop = async ({
  agentShareId,
  gatewayOpId,
  interrupt,
  shareTopicId,
}: {
  agentShareId?: string;
  gatewayOpId: string;
  interrupt: { operationId: string; topicId?: string };
  shareTopicId: string;
}): Promise<boolean> => {
  // Synchronously, before any await: the reply freezes at what is on screen
  // now, and that exact text goes with the interrupt.
  const stopSnapshot = freezeGatewayRunForStop(gatewayOpId);

  // Share visitors have no access to the owner-scoped interrupt (and no device
  // runtimes to confirm), so they go through the share mirror.
  if (agentShareId) {
    await shareChatService
      .interruptTask(agentShareId, shareTopicId, interrupt.operationId, stopSnapshot)
      .catch((err) => {
        // The server run keeps going; keep rendering what it streams instead
        // of hiding text it will save anyway.
        unfreezeGatewayRunForStop(gatewayOpId);
        console.error('[Gateway] share interruptTask failed:', err);
      });
    return false;
  }

  try {
    await interruptGatewayTaskOrThrow({ ...interrupt, stopSnapshot });
  } catch (error) {
    // `cancelOperation` restores the run as live; keep rendering it.
    unfreezeGatewayRunForStop(gatewayOpId);
    throw error;
  }
  return true;
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

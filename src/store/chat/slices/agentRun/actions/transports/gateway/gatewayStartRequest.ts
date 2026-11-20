import { aiAgentService } from '@/services/aiAgent';
import type { OperationCancelContext } from '@/store/chat/slices/operation/types';
import { RunStopUnconfirmedError } from '@/store/chat/utils/runStop';

/**
 * Interrupts a gateway operation and rejects when its physical shutdown is unconfirmed.
 *
 * Device confirmation is authoritative for local heterogeneous agents because
 * their server runtime may already be absent while the native process still
 * needs to release its writer. Other runtimes fall back to the service result.
 * A run the server settled because its device runner was gone answers with no
 * confirmation and `success: true`, which counts as stopped.
 *
 * Rejects with a {@link RunStopUnconfirmedError} carrying the server's
 * `failureReason`, so the stop can say why it failed and offer `force`.
 *
 * Pass the operation's cancel context: a cancel re-run as "Force end" carries
 * `metadata.forceStop`, which asks the server to end the run anyway.
 */
export const interruptGatewayTaskOrThrow = async (
  params: Parameters<typeof aiAgentService.interruptTask>[0],
  cancel?: Pick<OperationCancelContext, 'metadata'>,
): Promise<void> => {
  const result = await aiAgentService.interruptTask(
    cancel?.metadata?.forceStop ? { ...params, force: true } : params,
  );
  const cancellationConfirmed = result.deviceCancellationConfirmed ?? result.success;

  if (!cancellationConfirmed) {
    throw new RunStopUnconfirmedError(
      `Gateway operation ${params.operationId ?? 'unknown'} cancellation unconfirmed`,
      result.failureReason,
    );
  }
};

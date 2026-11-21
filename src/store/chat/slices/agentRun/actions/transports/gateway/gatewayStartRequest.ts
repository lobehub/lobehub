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

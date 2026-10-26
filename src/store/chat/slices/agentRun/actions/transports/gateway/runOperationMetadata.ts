import type { OperationMetadata } from '@/store/chat/slices/operation/types';

/**
 * Builds the metadata a local operation mirroring a top-level Gateway run starts with.
 *
 * Use when:
 * - Starting the `execServerAgentRuntime` op for a freshly dispatched or a reconnected run.
 *
 * Expects:
 * - `operationId` is the server-side run id. Human-intervention flows (approve / reject /
 *   reject_continue) read it back as `serverOperationId` to call the server without an
 *   out-of-band lookup.
 * - `heteroType` is the server's producer discriminator: an external CLI type, `null` for the
 *   native runtime, `undefined` when an older server or topic marker omitted it.
 *
 * Returns:
 * - The run identity fields of the op's metadata; QueueTray reads `heteroType` to tell when
 *   queued follow-ups will be sent.
 */
export const gatewayRunOperationMetadata = ({
  heteroType,
  operationId,
}: {
  heteroType?: string | null;
  operationId: string;
}): Pick<OperationMetadata, 'heteroType' | 'serverOperationId'> => ({
  heteroType,
  serverOperationId: operationId,
});

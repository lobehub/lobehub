import type { Operation, OperationMetadata } from '@/store/chat/slices/operation/types';

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

/**
 * Whether a hub `op_lifecycle` notice reports the end of a run the user stopped in this tab.
 *
 * Use when:
 * - Deciding whether such a notice should refetch the conversation. It is forwarded
 *   asynchronously and can land after the run's socket closed on the terminal frame, yet before
 *   the server's in-flight step persisted the partial reply: a refetch then replaces the
 *   streamed text with the step's empty placeholder, which the terminal handler kept on purpose.
 *
 * Returns:
 * - `true` for an `interrupted` notice whose run a cancelled local `execServerAgentRuntime` op
 *   mirrors.
 */
export const isLocalStopNotice = (
  operations: Record<string, Operation> | undefined,
  notice: { operationId: string; status: string },
): boolean =>
  notice.status === 'interrupted' &&
  Object.values(operations ?? {}).some(
    (op) =>
      op.type === 'execServerAgentRuntime' &&
      op.status === 'cancelled' &&
      op.metadata.serverOperationId === notice.operationId,
  );

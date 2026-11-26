import type { ChatStoreState } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import type { Operation } from '@/store/chat/slices/operation/types';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import type { MessageMapKeyInput } from '@/store/chat/utils/messageMapKey';

/**
 * Whether an operation drives the tray's timer. Child operations inherit
 * `turnStartTime`, so only a steered `sendMessage` counts beyond runtime types.
 */
export const isOpStatusRuntimeOperation = (op: Operation): boolean =>
  AI_RUNTIME_OPERATION_TYPES.includes(op.type) ||
  (op.type === 'sendMessage' && op.metadata.turnStartTime !== undefined);

/**
 * Whether `OpStatusTray` renders for a conversation context.
 *
 * Use when:
 * - A sibling surface has to adapt to the tray, such as squaring its corners or
 *   dropping a running indicator the tray already covers.
 */
export const isOpStatusVisible =
  (context: MessageMapKeyInput) =>
  (s: ChatStoreState): boolean => {
    const hasVisibleRun = operationSelectors
      .getOperationsByContext(context)(s)
      .some(
        (op) =>
          op.status === 'running' &&
          !op.metadata.isAborting &&
          !op.metadata.visibleLoadingDone &&
          isOpStatusRuntimeOperation(op),
      );
    if (hasVisibleRun) return true;

    return (
      operationSelectors.isSteerHandoffPending(context)(s) &&
      !!operationSelectors.getLatestAgentRuntimeTurnStartTime(context)(s)
    );
  };

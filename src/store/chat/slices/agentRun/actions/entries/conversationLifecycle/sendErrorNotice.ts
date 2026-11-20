import type { OperationContext } from '@/store/chat/slices/operation/types';
import type { ChatStore } from '@/store/chat/store';

/**
 * Shows a refused send's notice above the composer of `context`. The composer
 * reads the notice from the latest failed `sendMessage` operation of its own
 * context, so a refusal whose operation belongs to a discarded topic (a first
 * send that minted a topic and rolled it back) needs a record in the
 * conversation the user lands on.
 */
export const showSendErrorInContext = (
  store: ChatStore,
  context: OperationContext,
  message: string,
): void => {
  const { operationId } = store.startOperation({ context, type: 'sendMessage' });
  store.failOperation(operationId, { message, type: 'GatewayError' });
  store.updateOperationMetadata(operationId, { inputSendErrorMsg: message });
};

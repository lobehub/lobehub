// Fixture: the gateway handler already applies each message patch, yet it
// also re-reads the whole topic on every tool_end.
import type { ChatStore, GatewayEvent } from './types';

export const createGatewayEventHandler = (store: ChatStore, topicId: string) => {
  return async (event: GatewayEvent) => {
    switch (event.type) {
      case 'message_patch': {
        store.applyMessagePatch(topicId, event.patch);
        break;
      }
      case 'tool_end': {
        store.completeToolCall(event.toolCallId, event.result);
        // alint-expect
        await store.refreshMessages(topicId);
        break;
      }
    }
  };
};

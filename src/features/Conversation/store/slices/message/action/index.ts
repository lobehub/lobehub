import type { StateCreator } from 'zustand';

import type { Store as ConversationStore } from '../../../action';
import { type MessageCRUDAction, messageCRUDSlice } from './crud';
import { type MessageReactionAction, messageReactionSlice } from './reaction';
import { sendMessage } from './sendMessage';
import type { MessageStateAction } from './state';
import { messageStateSlice } from './state';

/**
 * Message Actions
 *
 * Handles all message operations:
 * - CRUD (create, read, update, delete)
 * - Reaction (add, remove emoji reactions)
 * - State management (loading, collapsed, editing)
 * - Sending messages
 */
export interface MessageAction
  extends MessageCRUDAction, MessageReactionAction, MessageStateAction {
  /**
   * Send a message in this conversation (unified Main + Thread)
   */
  sendMessage: ReturnType<typeof sendMessage>;
}

export const messageSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  MessageAction
> = (set, get, ...rest) => ({
  // Spread CRUD actions
  ...messageCRUDSlice(set, get, ...rest),

  // Spread reaction actions
  ...messageReactionSlice(set, get, ...rest),

  // Spread state actions
  ...messageStateSlice(set, get, ...rest),

  // Send message
  sendMessage: sendMessage(set, get),
});

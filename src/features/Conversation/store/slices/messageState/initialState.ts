/**
 * Message UI state (editing, loading, etc.)
 */
export interface MessageStateState {
  /**
   * IDs of messages currently being edited
   */
  messageEditingIds: string[];

  /**
   * IDs of messages currently loading (creating, updating, etc.)
   */
  messageLoadingIds: string[];

  /**
   * Pending plugin arguments update promises by message ID
   * Used to ensure approve/reject waits for pending saves to complete
   */
  pendingArgsUpdates: Map<string, Promise<void>>;
}

export const messageStateInitialState: MessageStateState = {
  messageEditingIds: [],
  messageLoadingIds: [],
  pendingArgsUpdates: new Map(),
};

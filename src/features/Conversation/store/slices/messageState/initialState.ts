/**
 * Message UI state (editing, loading, etc.)
 */
export interface MessageStateState {
  /**
   * Consecutive auto-retry count for heterogeneous-agent "overloaded" errors,
   * keyed by the parent user message id (stable across the delete+recreate
   * cycle a retry performs). Drives the backoff schedule and the
   * exhausted→manual fallback; cancelling pins it past the cap.
   */
  heteroOverloadRetryAttempts: Record<string, number>;

  /**
   * Operation id of the in-flight "auto-retry pending" operation per turn
   * (keyed by parent user message id). This operation stays running for the
   * whole countdown so the turn keeps its loading/in-progress state between
   * attempts; cancelling it (Stop / guide cancel) tears the auto-retry down.
   */
  heteroOverloadWaitOpIds: Record<string, string>;

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

  /**
   * IDs of messages currently checked in multi-select mode. Only meaningful
   * while `selectionMode` is true; cleared on exit.
   */
  selectedMessageIds: string[];

  /**
   * The message multi-select mode was entered from. Anchors the "select to
   * here" range action (top-of-conversation → anchor).
   */
  selectionAnchorId?: string;

  /**
   * Whether the conversation is in multi-select mode (used to forward several
   * messages to another agent). When true, each message renders a checkbox and
   * the per-message action bar is suppressed.
   */
  selectionMode: boolean;
}

export const messageStateInitialState: MessageStateState = {
  heteroOverloadRetryAttempts: {},
  heteroOverloadWaitOpIds: {},
  messageEditingIds: [],
  messageLoadingIds: [],
  pendingArgsUpdates: new Map(),
  selectionAnchorId: undefined,
  selectedMessageIds: [],
  selectionMode: false,
};

import { type UIChatMessage } from '@lobechat/types';

export interface DataState {
  /**
   * Raw messages from DB (before parsing)
   * Order is preserved from database fetch
   */
  dbMessages: UIChatMessage[];

  /**
   * Display messages array (parsed and sorted from conversation-flow)
   * This is the source of truth for rendering
   */
  displayMessages: UIChatMessage[];

  /**
   * The last round-cursor page fetch failed. Drives the inline
   * error row with Retry at the top of the list; cleared when a retry starts
   * and on conversation switch.
   */
  earlierMessagesError?: unknown;

  /**
   * A round-cursor fetch for history older than the server's newest-first
   * window is in flight. Drives the top-of-list loading hint.
   */
  isLoadingEarlierMessages: boolean;

  /**
   * Whether messages have been initialized
   */
  messagesInit: boolean;

  /**
   * While cached rows are on screen and the conversation's first server fetch
   * is still in flight, the id of the rendered row that shows the "fetching
   * latest messages" hint (the latest assistant reply's row).
   */
  refreshingRowId?: string;

  /**
   * Skip internal message fetching (when external messages are provided)
   */
  skipFetch?: boolean;
}

export const dataInitialState: DataState = {
  dbMessages: [],
  displayMessages: [],
  isLoadingEarlierMessages: false,
  messagesInit: false,
};

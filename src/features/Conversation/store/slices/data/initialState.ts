import { type UIChatMessage } from '@lobechat/types';

import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type ConversationMessagePage } from '@/services/message/replica';

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
   * Paging bookkeeping of the transcript in `dbMessages` (cursor of the next
   * older page, loaded depth). Absent until a fetch or hydration lands.
   */
  messagePaging?: Omit<ConversationMessagePage, 'items'>;

  /**
   * Replica bookkeeping of this conversation's transcript (`dbMessages` +
   * `messagePaging` are its view).
   */
  messageReplica: ReplicaState<ConversationMessagePage>;

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
  messageReplica: createReplicaState(),
  messagesInit: false,
};

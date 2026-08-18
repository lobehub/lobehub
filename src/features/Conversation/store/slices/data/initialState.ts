import { type UIChatMessage } from '@lobechat/types';

import { type MessageRoundCursor } from '@/services/message';

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
   * A `loadMoreMessages` page is in flight (single-flight guard + top
   * sentinel spinner).
   */
  isLoadingMoreMessages: boolean;

  /**
   * The last `loadMoreMessages` page failed. Rendered as an inline retry row —
   * cleared on the next successful page.
   */
  loadMoreMessagesError?: Error;

  // Cursor-window pagination metadata (gateway-mode paged read path only; the
  // legacy full fetch leaves these at their defaults = "everything loaded").
  /** Older rounds exist below the loaded window (shows the scroll-up loader). */
  messagesHasMore: boolean;

  /**
   * Whether messages have been initialized
   */
  messagesInit: boolean;
  /** Cursor for the next older page, straight from the server. */
  messagesNextCursor: MessageRoundCursor | null;
  /**
   * Bumped on every successful `loadMoreMessages` prepend. The virtualized
   * list watches it to flip virtua's `shift` flag for exactly the commits that
   * insert rows at the head, keeping the visual scroll position stable.
   */
  messagesPrependNonce: number;
  /**
   * Lower bound of the loaded window — sent as `anchor` on revalidation so the
   * refreshed window still reaches down to every loaded round.
   */
  messagesWindowStart: MessageRoundCursor | null;

  /**
   * Skip internal message fetching (when external messages are provided)
   */
  skipFetch?: boolean;
}

export const dataInitialState: DataState = {
  dbMessages: [],
  displayMessages: [],
  isLoadingMoreMessages: false,
  messagesHasMore: false,
  messagesInit: false,
  messagesNextCursor: null,
  messagesPrependNonce: 0,
  messagesWindowStart: null,
};

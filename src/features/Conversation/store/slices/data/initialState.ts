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
   * Whether messages have been initialized
   */
  messagesInit: boolean;

  /**
   * Skip internal message fetching (when external messages are provided)
   */
  skipFetch?: boolean;
}

export const dataInitialState: DataState = {
  dbMessages: [],
  displayMessages: [],
  messagesInit: false,
};

import { type UIChatMessage } from '@lobechat/types';

import { type ChatGroupAgentItem } from '@/database/schemas/chatGroup';

export interface ChatMessageState {
  activeAgentId: string;
  /**
   * @deprecated
   */
  activeId: string;
  /**
   * Raw messages from database (flat structure)
   */
  dbMessagesMap: Record<string, UIChatMessage[]>;
  /**
   * Group agents maps by group ID
   */
  groupAgentMaps: Record<string, ChatGroupAgentItem[]>;
  isCreatingMessage: boolean;
  /**
   * is the message is editing
   */
  messageEditingIds: string[];
  /**
   * is the message is creating or updating in the service
   */
  messageLoadingIds: string[];
  /**
   * whether messages have fetched
   */
  messagesInit: boolean;
  /**
   * Parsed messages for display (includes assistantGroup from conversation-flow)
   */
  messagesMap: Record<string, UIChatMessage[]>;
}

export const initialMessageState: ChatMessageState = {
  activeAgentId: '',
  activeId: 'inbox',
  dbMessagesMap: {},
  groupAgentMaps: {},
  isCreatingMessage: false,
  messageEditingIds: [],
  messageLoadingIds: [],
  messagesInit: false,
  messagesMap: {},
};

import { UIChatMessage } from '@lobechat/types';

import { ChatGroupAgentItem, ChatGroupItem } from '@/database/schemas/chatGroup';

import type { SupervisorTodoItem } from './supervisor';

export interface ChatMessageState {
  /**
   * @title 当前活动的会话
   * @description 当前正在编辑或查看的会话
   */
  activeId: string;
  /**
   * Type of the currently active session ('agent' | 'group')
   * Derived from session.type, used for caching to avoid repeated lookups
   */
  activeSessionType?: 'agent' | 'group';
  /**
   * Group agents maps by group ID
   */
  groupAgentMaps: Record<string, ChatGroupAgentItem[]>;
  /**
   * Group data maps by group ID
   */
  groupMaps: Record<string, ChatGroupItem>;
  /**
   * Groups initialization status
   */
  groupsInit: boolean;
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
  messagesMap: Record<string, UIChatMessage[]>;
  /**
   * Supervisor decision debounce timers by group ID
   */
  supervisorDebounceTimers: Record<string, number>;
  /**
   * Supervisor decision abort controllers by group ID
   */
  supervisorDecisionAbortControllers: Record<string, AbortController>;
  /**
   * Supervisor decision loading states
   */
  supervisorDecisionLoading: string[];
  /**
   * Supervisor todo list map keyed by session/topic combination
   */
  supervisorTodos: Record<string, SupervisorTodoItem[]>;
}

export const initialMessageState: ChatMessageState = {
  activeId: 'inbox',
  activeSessionType: undefined,
  groupAgentMaps: {},
  groupMaps: {},
  groupsInit: false,
  isCreatingMessage: false,
  messageEditingIds: [],
  messageLoadingIds: [],
  messagesInit: false,
  messagesMap: {},
  supervisorDebounceTimers: {},
  supervisorDecisionAbortControllers: {},
  supervisorDecisionLoading: [],
  supervisorTodos: {},
};

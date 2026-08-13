import { type ParsedQuery } from 'query-string';

export interface QueryRouter {
  push: (url: string, options?: { query?: ParsedQuery; replace?: boolean }) => void;
}

export interface ChatGroupState {
  activeGroupId?: string;
  activeThreadAgentId: string;
  router?: QueryRouter;
  showGroupSetting: boolean;
  /**
   * Content being streamed for system prompt update (for GroupAgentBuilder)
   */
  streamingSystemPrompt?: string;
  /**
   * Whether system prompt streaming is in progress
   */
  streamingSystemPromptInProgress?: boolean;
}

export const initialChatGroupState: ChatGroupState = {
  activeThreadAgentId: '',
  showGroupSetting: false,
  streamingSystemPrompt: undefined,
  streamingSystemPromptInProgress: false,
};

import { type AgentGroupDetail } from '@lobechat/types';
import { type ParsedQuery } from 'query-string';

import { type ChatGroupItem } from '@/database/schemas/chatGroup';

export interface QueryRouter {
  push: (url: string, options?: { query?: ParsedQuery; replace?: boolean }) => void;
}

export interface ChatGroupState {
  activeGroupId?: string;
  activeThreadAgentId: string;
  groupMap: Record<string, AgentGroupDetail>;
  /**
   * Groups whose detail fetch succeeded but resolved to nothing — the group
   * doesn't exist or the caller lost access (e.g. a workspace group's owner
   * switched it back to private). Settled and non-retryable: render a 404
   * card, not a loading skeleton or an empty conversation shell. Cleared when
   * a later fetch succeeds.
   */
  groupNotFoundMap: Record<string, boolean>;
  groups: ChatGroupItem[];
  groupsInit: boolean;
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
  groupMap: {},
  groupNotFoundMap: {},
  groups: [],
  groupsInit: false,
  showGroupSetting: false,
  streamingSystemPrompt: undefined,
  streamingSystemPromptInProgress: false,
};

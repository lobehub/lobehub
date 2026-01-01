import type { AgentGroupDetail } from '@lobechat/types';

import type { ChatGroupItem } from '@/database/schemas/chatGroup';

export interface ChatGroupState {
  activeGroupId?: string;
  activeThreadAgentId: string;
  groupMap: Record<string, AgentGroupDetail>;
  groups: ChatGroupItem[];
  groupsInit: boolean;
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
  groups: [],
  groupsInit: false,
  showGroupSetting: false,
  streamingSystemPrompt: undefined,
  streamingSystemPromptInProgress: false,
};

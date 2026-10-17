import { type AgentGroupDetail } from '@lobechat/types';
import { type ParsedQuery } from 'query-string';

import { type ChatGroupItem } from '@/database/schemas/chatGroup';
import { createReplicaState, type ReplicaState } from '@/libs/replica';

export interface QueryRouter {
  push: (url: string, options?: { query?: ParsedQuery; replace?: boolean }) => void;
}

export interface ChatGroupState {
  activeGroupId?: string;
  activeThreadAgentId: string;
  /** Replica bookkeeping for `groupMap`. */
  agentGroupDetailReplica: ReplicaState<AgentGroupDetail>;
  /** Replica bookkeeping for `groups`. */
  agentGroupListReplica: ReplicaState<ChatGroupItem[]>;
  /** Detailed groups by id. Replica view of `agentGroupDetailReplica`. */
  groupMap: Record<string, AgentGroupDetail>;
  /**
   * Groups whose detail fetch succeeded but resolved to nothing — the group
   * doesn't exist or the caller lost access (e.g. a workspace group's owner
   * switched it back to private). Settled and non-retryable: render a 404
   * card, not a loading skeleton or an empty conversation shell. Cleared when
   * a later fetch succeeds.
   */
  groupNotFoundMap: Record<string, boolean>;
  /** Group metadata rows of the active scope. Replica view of `agentGroupListReplica`. */
  groups: ChatGroupItem[];
  /**
   * Whether the group list has been filled (from storage or the server). Gates
   * the list replica lens: an un-loaded list must read `undefined`, otherwise
   * hydration would treat the empty default as a real value.
   */
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
  agentGroupDetailReplica: createReplicaState(),
  agentGroupListReplica: createReplicaState(),
  groupMap: {},
  groupNotFoundMap: {},
  groups: [],
  groupsInit: false,
  showGroupSetting: false,
  streamingSystemPrompt: undefined,
  streamingSystemPromptInProgress: false,
};

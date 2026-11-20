import { createReplicaState, type ReplicaState } from '@/libs/replica';
import { type AgentKnowledgeSpaceItem, type KnowledgeBaseItem } from '@/types/knowledgeBase';

export interface KnowledgeBaseState {
  activeKnowledgeBaseId: string | null;
  /** Agents' dedicated libraries (`agentSpaceListMap.all`). */
  agentSpaceListMap: Record<string, AgentKnowledgeSpaceItem[]>;
  /** Local-first bookkeeping for `agentSpaceListMap`. */
  agentSpaceListReplica: ReplicaState<AgentKnowledgeSpaceItem[]>;
  /** By-id KB projection (`knowledgeBaseDetailMap[id]`). */
  knowledgeBaseDetailMap: Record<string, KnowledgeBaseItem>;
  /** Local-first bookkeeping for `knowledgeBaseDetailMap`. */
  knowledgeBaseDetailReplica: ReplicaState<KnowledgeBaseItem>;
  /** The KB list per visibility surface (`knowledgeBaseListMap[all|private|public]`). */
  knowledgeBaseListMap: Record<string, KnowledgeBaseItem[]>;
  /** Local-first bookkeeping for `knowledgeBaseListMap`. */
  knowledgeBaseListReplica: ReplicaState<KnowledgeBaseItem[]>;
  /** Ids whose update round-trip is in flight (drives the sidebar row spinner). */
  knowledgeBaseLoadingIds: string[];
  /** The row currently being renamed inline. */
  knowledgeBaseRenamingId?: string | null;
}

export const initialKnowledgeBaseState: KnowledgeBaseState = {
  activeKnowledgeBaseId: null,
  agentSpaceListMap: {},
  agentSpaceListReplica: createReplicaState(),
  knowledgeBaseDetailMap: {},
  knowledgeBaseDetailReplica: createReplicaState(),
  knowledgeBaseListMap: {},
  knowledgeBaseListReplica: createReplicaState(),
  knowledgeBaseLoadingIds: [],
  knowledgeBaseRenamingId: null,
};

import type {
  TopicPullRequestItem,
  WorkListItem,
  WorkSummaryItem,
  WorkVersionItem,
} from '@lobechat/types';

import { createReplicaState, type ReplicaPagedData, type ReplicaState } from '@/libs/replica';

/** One gallery filter's loaded pages. */
export type WorkspaceWorksData = ReplicaPagedData<WorkSummaryItem, string>;

export interface WorkState {
  /** Latest Works by origin agent (`agentWorksResource` key). */
  agentWorksMap: Record<string, WorkSummaryItem[]>;
  agentWorksReplica: ReplicaState<WorkSummaryItem[]>;
  /** Sidebar Work history by conversation (`conversationWorksKey`). */
  conversationWorksMap: Record<string, WorkListItem[]>;
  conversationWorksReplica: ReplicaState<WorkListItem[]>;
  /** Pull requests linked to a topic, by topic id. */
  topicPullRequestsMap: Record<string, TopicPullRequestItem[]>;
  topicPullRequestsReplica: ReplicaState<TopicPullRequestItem[]>;
  /** Workspace gallery pages by filter (`workspaceWorksKey`). */
  workspaceWorksMap: Record<string, WorkspaceWorksData>;
  workspaceWorksReplica: ReplicaState<WorkspaceWorksData>;
  /** Version timelines by Work id. */
  workVersionsMap: Record<string, WorkVersionItem[]>;
  workVersionsReplica: ReplicaState<WorkVersionItem[]>;
}

export const initialWorkState: WorkState = {
  agentWorksMap: {},
  agentWorksReplica: createReplicaState(),
  conversationWorksMap: {},
  conversationWorksReplica: createReplicaState(),
  topicPullRequestsMap: {},
  topicPullRequestsReplica: createReplicaState(),
  workVersionsMap: {},
  workVersionsReplica: createReplicaState(),
  workspaceWorksMap: {},
  workspaceWorksReplica: createReplicaState(),
};

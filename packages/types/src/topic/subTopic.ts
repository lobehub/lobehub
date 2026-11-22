import type { AgentOperationStatus } from '../agentOperation';
import type { ChatTopicStatus, TopicOpenedBy } from './topic';

/** What a sub-topic is doing, read from its latest run and its own status. */
export type SubTopicState = 'archived' | 'failed' | 'idle' | 'running' | 'waiting_for_user';

/** The agent a sub-topic runs, for the cross-agent avatar in the sidebar. */
export interface SubTopicAgentDisplay {
  avatar: null | string;
  backgroundColor: null | string;
  title: null | string;
}

/**
 * A live topic opened from another one, as the opened-by queries return it
 * (`TopicModel.listOpenedTopics` / `listOpenedDescendants`).
 */
export interface OpenedTopicItem {
  agentId: string | null;
  createdAt: Date;
  favorite: boolean | null;
  id: string;
  /** Status of the topic's latest top-level operation; null before its first run. */
  latestRunStatus: AgentOperationStatus | null;
  openedBy: TopicOpenedBy;
  runStartedAt: Date | null;
  status: ChatTopicStatus | null;
  /** The task a task-run sub-topic belongs to (`metadata.taskId`). */
  taskId: string | null;
  title: string | null;
  trigger: string | null;
  updatedAt: Date;
}

/** One live sub-topic row of the sidebar hierarchy (`topic.listChildTopics`). */
export interface OpenedSubTopic {
  agent?: SubTopicAgentDisplay;
  agentId: null | string;
  id: string;
  openedBy: TopicOpenedBy;
  runStartedAt: Date | null;
  state: SubTopicState;
  status: ChatTopicStatus | null;
  /** The task a task-run sub-topic belongs to. */
  taskId: null | string;
  title: null | string;
  trigger: null | string;
  updatedAt: Date;
}

/** A sub-topic moved to the top level, and whose list received it. */
export interface SubTopicMove {
  agentId: null | string;
  /** The receiving agent's title, for the "moved to …" notice. */
  agentTitle: null | string;
  id: string;
  /** It went back to its own agent's list rather than staying in the parent's agent. */
  movedToOwnAgent: boolean;
  trigger: null | string;
}

/** Sub-topics moved to the top level (`topic.updateTopic({ detachFromParent })`). */
export interface SubTopicDetachResult {
  detached: SubTopicMove[];
}

/** An archive / delete of a topic tree: what was retired and what moved up. */
export interface SubTopicRetireResult extends SubTopicDetachResult {
  /** Retired topic ids, deepest first, the topic itself last. */
  retired: string[];
}

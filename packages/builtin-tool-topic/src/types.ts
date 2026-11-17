export const TopicToolApiName = {
  archiveTopic: 'archiveTopic',
  getTopic: 'getTopic',
  listTopics: 'listTopics',
  readTopic: 'readTopic',
  sendToTopic: 'sendToTopic',
  openTopic: 'openTopic',
  stopTopic: 'stopTopic',
} as const;

export type TopicToolApiNameType = (typeof TopicToolApiName)[keyof typeof TopicToolApiName];

/** Where a sub-topic works. */
export type SubTopicWorkspace = 'inherit' | 'new-worktree' | 'none';

export type SubTopicState = 'archived' | 'failed' | 'idle' | 'running' | 'waiting_for_user';

export interface OpenTopicParams {
  /** Agent to run the sub-topic; defaults to the current agent. */
  agentId?: string;
  /** Branch a new worktree forks from (`workspace: 'new-worktree'`). */
  baseBranch?: string;
  /** Device to run on; defaults to this conversation's device. */
  deviceId?: string;
  prompt: string;
  title?: string;
  workspace?: SubTopicWorkspace;
}

export interface OpenTopicState {
  agentId?: string;
  branch?: string;
  topicId: string;
  workingDirectory?: string;
}

export interface TopicIdParams {
  topicId: string;
}

export interface ReadTopicParams extends TopicIdParams {
  /** How many of the latest messages to read (default 30). */
  limit?: number;
}

export interface SendToTopicParams extends TopicIdParams {
  message: string;
}

export interface SubTopicSummary {
  agentId?: null | string;
  state: SubTopicState;
  title?: null | string;
  topicId: string;
}

export interface ListTopicsState {
  topics: SubTopicSummary[];
}

export interface GetTopicState extends SubTopicSummary {
  lastReply?: string;
}

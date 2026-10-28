export interface TopicHoverRow {
  agentId: string;
  groupId?: string | null;
  status?: string | null;
  topicId: string;
}

export interface TopicHoverEnv {
  activeTopicId?: string | null;
  creatingTopicIds: string[];
  enabled: boolean;
  hasLocalMessages: (row: TopicHoverRow) => boolean;
  hasPreview: (topicId: string) => boolean;
  hasReadingPosition: (row: TopicHoverRow) => boolean;
  // Browser-run agents read whole 1000-row pages, which a hover must not trigger.
  isProjectedRead: (agentId: string) => boolean;
  isRunning: (row: TopicHoverRow) => boolean;
}

const isUnopenedServerTopic = (row: TopicHoverRow, env: TopicHoverEnv) =>
  env.enabled &&
  env.isProjectedRead(row.agentId) &&
  row.topicId !== env.activeTopicId &&
  !env.creatingTopicIds.includes(row.topicId) &&
  !env.hasLocalMessages(row);

export const canPrefetchTopicFirstPage = (row: TopicHoverRow, env: TopicHoverEnv) =>
  isUnopenedServerTopic(row, env);

export const canPreviewTopic = (row: TopicHoverRow, env: TopicHoverEnv) =>
  isUnopenedServerTopic(row, env) &&
  !row.groupId &&
  row.status !== 'running' &&
  row.status !== 'waitingForHuman' &&
  !env.isRunning(row) &&
  !env.hasPreview(row.topicId) &&
  !env.hasReadingPosition(row);

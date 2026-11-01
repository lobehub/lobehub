export interface TopicAutoSummaryCursor {
  id: string;
  lastMessageUpdatedAt: string;
}

/** Explicit operator controls. Omitted values use conservative production defaults. */
export interface DispatchTopicAutoSummaryPayload {
  cursor?: TopicAutoSummaryCursor;
  dryRun?: boolean;
  force?: boolean;
  idleMinutes?: number;
  lookbackHours?: number;
  maxTopics?: number;
  pageSize?: number;
  processed?: number;
}

export interface ExecuteTopicAutoSummaryPayload {
  force?: boolean;
  topicId: string;
  userId: string;
  workspaceId?: string;
}

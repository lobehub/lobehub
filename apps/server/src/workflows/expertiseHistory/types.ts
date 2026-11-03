export interface ExpertiseHistoryWorkflowPayload {
  agentId: string;
  cursor?: { lastActivityAt: string; topicId: string };
  userId: string;
  workspaceId?: string;
}

export interface ExpertiseHistoryTopicWorkflowPayload {
  agentId: string;
  topicId: string;
  userId: string;
  workspaceId?: string;
}

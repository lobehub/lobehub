export interface NotifyAgentRunCompletedParams {
  agentId?: string;
  duration?: number;
  lastAssistantContent?: string;
  operationId: string;
  topicId?: string;
  userId: string;
  workspaceId?: string;
}

export async function notifyAgentRunCompleted(
  _params: NotifyAgentRunCompletedParams,
): Promise<void> {}

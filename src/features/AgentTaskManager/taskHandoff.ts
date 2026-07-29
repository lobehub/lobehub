export const buildTaskHandoffPath = (agentId: string, topicId: string): string =>
  `/tasks?agentId=${encodeURIComponent(agentId)}&topicId=${encodeURIComponent(topicId)}`;

interface TaskHandoffMatch {
  routedAgentId?: string;
  routedTopicId?: string;
  selectedAgentId?: string;
}

/** Resolve the task-scoped topic handed off by the home composer. */
export const resolveTaskHandoffTopic = ({
  routedAgentId,
  routedTopicId,
  selectedAgentId,
}: TaskHandoffMatch): string | null =>
  routedAgentId === selectedAgentId && routedTopicId ? routedTopicId : null;

export const buildTaskHandoffPath = (agentId: string, topicId: string): string =>
  `/tasks?agentId=${encodeURIComponent(agentId)}&topicId=${encodeURIComponent(topicId)}`;

interface TaskHandoffMatch {
  activeTopicId?: string | null;
  routedAgentId?: string;
  routedTopicId?: string;
  selectedAgentId?: string;
}

/** Preserve the task-scoped topic handed off by the home composer. */
export const isTaskHandoffTopic = ({
  activeTopicId,
  routedAgentId,
  routedTopicId,
  selectedAgentId,
}: TaskHandoffMatch): boolean =>
  routedAgentId === selectedAgentId && !!routedTopicId && routedTopicId === activeTopicId;

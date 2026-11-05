interface FixtureTopic {
  metadata?: {
    workingDirectory?: string;
    workingDirectoryConfig?: { git?: { branch?: string }; path: string };
  };
}

export const formatPrice = (value: number) => value.toFixed(2);
export const formatTokenNumber = (value: number) => String(value);

export const getProjectInfo = (topic: FixtureTopic) => {
  const path = topic.metadata?.workingDirectoryConfig?.path ?? topic.metadata?.workingDirectory;
  if (!path) return undefined;
  return {
    branch: topic.metadata?.workingDirectoryConfig?.git?.branch,
    path: path.split('/').filter(Boolean).at(-1),
  };
};

export const formatActivityTime = () => ({ text: '2 hours ago', title: '2026-11-05 08:00' });

export const AGENT_CHAT_TOPIC_URL = (agentId: string, topicId: string) =>
  `/agent/${agentId}?topic=${topicId}`;

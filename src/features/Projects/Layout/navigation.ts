export const getProjectAgentPath = (agentId: string) => `/agent/${agentId}`;

export const getProjectConversationPath = (agentId: string, topicId?: string) =>
  topicId ? `/agent/${agentId}/${topicId}` : getProjectAgentPath(agentId);

export const getProjectConversationStartPath = (agentId: string, message: string) =>
  `${getProjectConversationPath(agentId)}?message=${encodeURIComponent(message)}`;

export const getProjectLibraryPath = (projectId: string, libraryId: string) =>
  `/project/${projectId}/library/${libraryId}`;

export const getProjectTasksPath = (projectId: string) => `/project/${projectId}/tasks`;

export const getProjectGoalsPath = (projectId: string) => `/project/${projectId}/goals`;

export const getProjectAcceptancePath = (projectId: string) => `/project/${projectId}/acceptance`;

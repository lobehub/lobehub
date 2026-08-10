export const getProjectAgentPath = (agentId: string) => `/agent/${agentId}`;

export const getProjectConversationPath = (projectId: string, topicId?: string) =>
  topicId ? `/project/${projectId}/conversation/${topicId}` : `/project/${projectId}/conversation`;

export const getProjectConversationStartPath = (projectId: string, message: string) =>
  `${getProjectConversationPath(projectId)}?message=${encodeURIComponent(message)}`;

export const getProjectLibraryPath = (projectId: string, libraryId: string) =>
  `/project/${projectId}/library/${libraryId}`;

export const getProjectTasksPath = (projectId: string) => `/project/${projectId}/tasks`;

export const getProjectGoalsPath = (projectId: string) => `/project/${projectId}/goals`;

export const getProjectAcceptancePath = (projectId: string) => `/project/${projectId}/acceptance`;

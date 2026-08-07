export const getProjectAgentPath = (agentId: string) => `/agent/${agentId}`;

export const getProjectLibraryPath = (projectId: string, libraryId: string) =>
  `/project/${projectId}/library/${libraryId}`;

export const getProjectTasksPath = (projectId: string) => `/project/${projectId}/tasks`;

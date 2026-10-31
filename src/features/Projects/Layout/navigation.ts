export const getProjectAgentPath = (agentId: string) => `/agent/${agentId}`;

export const getProjectHomePath = (projectId: string) => `/project/${projectId}`;

export const getProjectTopicPath = (projectId: string, topicId?: string) =>
  topicId ? `/project/${projectId}/topic/${topicId}` : `/project/${projectId}/topic`;

/**
 * A blank project conversation a sidebar "+" opened for one agent on one
 * directory. The draft lives in the route so it stays with its own pane (and
 * survives a reload); nothing is created until its first message.
 */
export const getProjectDraftPath = (projectId: string, agentId: string, directoryId: string) =>
  `${getProjectTopicPath(projectId)}?${new URLSearchParams({ agent: agentId, dir: directoryId })}`;

export const getProjectLibraryPath = (projectId: string, libraryId: string) =>
  `/project/${projectId}/library/${libraryId}`;

export const getProjectTasksPath = (projectId: string) => `/project/${projectId}/tasks`;

export const getProjectGoalsPath = (projectId: string) => `/project/${projectId}/goals`;

export const getProjectDashboardPath = (projectId: string, dashboardId?: string) =>
  dashboardId
    ? `/project/${projectId}/dashboard/${dashboardId}`
    : `/project/${projectId}/dashboard`;

export type ProjectSettingsSection = 'general' | 'knowledge' | 'members';

export const getProjectSettingsPath = (projectId: string, section: ProjectSettingsSection) =>
  `/project/${projectId}/settings/${section}`;

export const getProjectAcceptancePath = (projectId: string) => `/project/${projectId}/acceptance`;

/**
 * A workspace-scoped location carries the workspace slug (`/acme/project/…`)
 * while section paths are built without it. Drop the prefix before comparing.
 */
export const toProjectPathname = (pathname: string) => {
  const index = pathname.indexOf('/project/');
  return index > 0 ? pathname.slice(index) : pathname;
};

/** A section stays active on its own pages too — a board, an acceptance record. */
export const isProjectSectionActive = (pathname: string, sectionPath: string) =>
  pathname === sectionPath || pathname.startsWith(`${sectionPath}/`);

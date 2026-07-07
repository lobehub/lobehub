export type TaskVisibility = 'private' | 'public';

export const getTaskVisibilityDefaultLabel = (visibility: TaskVisibility) =>
  visibility === 'private' ? 'Private' : 'Workspace';

export const getTaskVisibilityLabelKey = (visibility: TaskVisibility) =>
  visibility === 'private' ? 'createTask.visibility.private' : 'createTask.visibility.workspace';

import { useWorkspaces } from './useWorkspaces';

export const useHasWorkspace = (): boolean => useWorkspaces().length > 0;

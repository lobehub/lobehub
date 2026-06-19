import { useWorkspaceListSWR } from './useWorkspaces';

export const useIsWorkspaceLoading = (): boolean => useWorkspaceListSWR().isLoading;

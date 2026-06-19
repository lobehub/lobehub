import { useActiveWorkspaceId } from './useActiveWorkspaceId';

export const useHasActiveWorkspace = (): boolean => !!useActiveWorkspaceId();

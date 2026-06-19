import { getActiveWorkspaceId } from './hooks/useActiveWorkspaceId';

export const getBusinessTrpcHeaders = async (): Promise<Record<string, string>> => {
  const workspaceId = getActiveWorkspaceId();

  return workspaceId ? { 'X-Workspace-Id': workspaceId } : {};
};

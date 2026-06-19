import type { WorkspaceItem } from '@lobechat/database/schemas';

import { useActiveWorkspaceId } from './useActiveWorkspaceId';
import { useWorkspaces } from './useWorkspaces';

export type WorkspaceListItem = WorkspaceItem & { plan?: 'hobby' | 'pro'; role?: string };

export const useActiveWorkspace = (): WorkspaceListItem | null => {
  const id = useActiveWorkspaceId();
  const workspaces = useWorkspaces();

  return workspaces.find((workspace) => workspace.id === id) ?? null;
};

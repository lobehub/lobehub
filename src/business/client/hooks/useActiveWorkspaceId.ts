import {
  getWorkspaceSnapshot,
  hydrateActiveWorkspaceId,
  useWorkspaceSnapshot,
} from './workspaceState';

export const getActiveWorkspaceId = (): string | null =>
  getWorkspaceSnapshot().id ?? hydrateActiveWorkspaceId();

export const useActiveWorkspaceId = (): string | null =>
  useWorkspaceSnapshot().id ?? hydrateActiveWorkspaceId();

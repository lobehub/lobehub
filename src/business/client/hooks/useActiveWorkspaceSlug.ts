import { getWorkspaceSnapshot, useWorkspaceSnapshot } from './workspaceState';

export const getActiveWorkspaceSlug = (): string | null => getWorkspaceSnapshot().slug;

export const useActiveWorkspaceSlug = (): string | null => useWorkspaceSnapshot().slug;

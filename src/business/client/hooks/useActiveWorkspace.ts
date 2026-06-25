import type { WorkspaceItem } from '@lobechat/database/schemas';

export type WorkspaceListItem = WorkspaceItem & { plan?: 'free' | 'pro'; role?: string };

export const useActiveWorkspace = (): WorkspaceListItem | null => null;

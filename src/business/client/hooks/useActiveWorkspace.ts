import type { WorkspaceItem } from '@lobechat/database/schemas';

export type WorkspaceListItem = WorkspaceItem & { plan?: 'hobby' | 'pro'; role?: string };

export const useActiveWorkspace = (): WorkspaceListItem | null => null;

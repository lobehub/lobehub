import type { WorkspaceListItem } from './useActiveWorkspace';

/** Mirrors the opt-in demo workspace used by `useActiveWorkspaceId`. */
const demoWorkspaceId = process.env.NEXT_PUBLIC_DEMO_WORKSPACE_ID;

const DEMO_WORKSPACES = demoWorkspaceId
  ? ([
      { id: demoWorkspaceId, name: 'Local preview', slug: 'local-preview' },
    ] as unknown as WorkspaceListItem[])
  : [];

export const useWorkspaces = (): WorkspaceListItem[] => DEMO_WORKSPACES;

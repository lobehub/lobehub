import { useCallback } from 'react';

import { useWorkspaces } from '@/business/client/hooks/useWorkspaces';

import type { WorkspaceSlugOf } from './state';

/** Resolves the workspace an activity was launched in to the slug its links open under. */
export const useWorkspaceSlugOf = (): WorkspaceSlugOf => {
  const workspaces = useWorkspaces();
  return useCallback((id) => workspaces.find((item) => item.id === id)?.slug, [workspaces]);
};

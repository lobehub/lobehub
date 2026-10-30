import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { docsPagePath, resolveResourceRoute } from '../../../paths';

/** The page open over the Docs home, and how a row opens one without leaving Docs. */
export const useOpenPage = () => {
  const navigate = useWorkspaceAwareNavigate();
  const location = useActiveLocation();
  const openedView = resolveResourceRoute(location.pathname, new URLSearchParams(location.search));
  const openPageId = openedView.kind === 'page' ? openedView.id : null;

  const openPage = useCallback((id: string) => navigate(docsPagePath(id)), [navigate]);

  return { openPage, openPageId };
};

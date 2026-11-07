import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useImLayout } from '@/features/NavRail/useImLayout';
import { useActiveLocation } from '@/hooks/useActiveLocation';

import { resolveRailNavPanelKey } from './railRouteKey';
import { resolveNavPanelKey } from './routeKey';

export const useActiveNavKey = () => {
  const { pathname } = useActiveLocation();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  // The `im_layout` rail folds chats into the conversation list and adds the
  // Contacts / Tasks list columns; off keeps the per-route sidebars.
  const imLayout = useImLayout();

  return (imLayout ? resolveRailNavPanelKey : resolveNavPanelKey)(pathname, activeWorkspaceSlug);
};

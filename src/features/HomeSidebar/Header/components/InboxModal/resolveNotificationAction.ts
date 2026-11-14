import { matchRoutes, type RouteObject } from 'react-router';
import urlJoin from 'url-join';

import { RESERVED_ROOT_SEGMENTS } from '@/features/Workspace/rootSegments';

export type NotificationAction =
  { type: 'external'; url: string } | { path: string; type: 'navigate' };

interface NotificationActionEnv {
  appOrigin: string;
  desktopTabRoutes?: RouteObject[];
}

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

const isRoutableInTab = (desktopTabRoutes: RouteObject[], path: string): boolean => {
  const leaf = matchRoutes(desktopTabRoutes, path)?.at(-1);
  if (!leaf || leaf.route.path === '*') return false;

  // A reserved root with no literal tab route (`/onboarding`) is otherwise
  // read as a workspace slug and lands on a workspace-not-found page.
  const { workspaceSlug } = leaf.params;
  return !workspaceSlug || !RESERVED_ROOT_SEGMENTS.has(workspaceSlug);
};

export const resolveNotificationAction = (
  actionUrl: string,
  { appOrigin, desktopTabRoutes }: NotificationActionEnv,
): NotificationAction => {
  if (ABSOLUTE_URL_REGEX.test(actionUrl)) return { type: 'external', url: actionUrl };

  // Desktop tabs mount only the main-area routes, so a root-level page such as
  // `/invite/:token` would hit the tab catch-all and bounce to home.
  if (desktopTabRoutes && appOrigin && !isRoutableInTab(desktopTabRoutes, actionUrl)) {
    return { type: 'external', url: urlJoin(appOrigin, actionUrl) };
  }

  return { path: actionUrl, type: 'navigate' };
};

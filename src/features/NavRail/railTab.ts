import { isRailContactsRoute } from '@/features/NavPanel/railRouteKey';

export type RailTabKey =
  'contacts' | 'discover' | 'messages' | 'more' | 'projects' | 'resource' | 'settings' | 'tasks';

const TAB_BY_ROOT: Record<string, RailTabKey> = {
  community: 'discover',
  dashboard: 'more',
  eval: 'more',
  goal: 'tasks',
  goals: 'tasks',
  image: 'more',
  memory: 'more',
  page: 'resource',
  project: 'projects',
  projects: 'projects',
  resource: 'resource',
  settings: 'settings',
  task: 'tasks',
  tasks: 'tasks',
  video: 'more',
};

/**
 * The rail tab a pathname belongs to. The home page is Messages; every page
 * inside an agent or group, chats included, is Contacts.
 */
export const resolveRailTab = (
  pathname: string,
  activeWorkspaceSlug: string | null,
): RailTabKey => {
  if (isRailContactsRoute(pathname, activeWorkspaceSlug)) return 'contacts';

  const segments = pathname.split('/').filter(Boolean);
  const isWorkspaceRoute =
    !!activeWorkspaceSlug && segments.length > 0 && segments[0] === activeWorkspaceSlug;
  const [rootSegment] = isWorkspaceRoute ? segments.slice(1) : segments;

  return (rootSegment && TAB_BY_ROOT[rootSegment]) || 'messages';
};

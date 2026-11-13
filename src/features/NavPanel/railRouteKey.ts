import { resolveNavPanelKey } from './routeKey';

/**
 * Nav key for routes whose page owns the whole wrap (no list column). The rail
 * still highlights their tab; NavPanel renders nothing for this key.
 */
export const NAV_PANEL_HIDDEN_KEY = 'none';

/** The IM-style conversation list (agents + groups) behind the Messages tab. */
export const NAV_PANEL_MESSAGES_KEY = 'home';

/** The task scope list (all tasks, goals, projects) behind the Tasks tab. */
export const NAV_PANEL_TASKS_KEY = 'tasks';

/** The contacts list (agents + groups) behind the Contacts tab. */
export const NAV_PANEL_CONTACTS_KEY = 'contacts';

/**
 * Roots whose every page is an agent or group's own inner page — its chats,
 * topics, profile and config — so the rail highlights Contacts for all of them.
 */
const CONTACT_ROOTS = new Set(['agent', 'group']);

const TASK_ROOTS = new Set(['goal', 'goals', 'task', 'tasks']);

const FULL_PAGE_ROOTS = new Set(['projects']);

const splitRoute = (pathname: string, activeWorkspaceSlug: string | null) => {
  const segments = pathname.split('/').filter(Boolean);
  const isWorkspaceRoute =
    !!activeWorkspaceSlug && segments.length > 0 && segments[0] === activeWorkspaceSlug;
  return isWorkspaceRoute ? segments.slice(1) : segments;
};

/**
 * Whether the rail highlights Contacts for this route: the all-agents page and
 * every page inside an agent or group, chats included.
 */
export const isRailContactsRoute = (
  pathname: string,
  activeWorkspaceSlug: string | null,
): boolean => {
  const [rootSegment, id] = splitRoute(pathname, activeWorkspaceSlug);
  if (rootSegment === 'agents') return true;
  return !!id && !!rootSegment && CONTACT_ROOTS.has(rootSegment);
};

/**
 * Nav key for the rail layout (rail + list column + content). Builds on the
 * legacy `resolveNavPanelKey`, which the mobile drawer still uses unchanged:
 * - agent / group routes keep their own workbench sidebar (topics, profile,
 *   goals, tasks), same as the sidebar layout;
 * - the all-agents page shows the Contacts list;
 * - tasks and goals share the task scope list (all tasks, goals, projects);
 * - the project index renders without a list column.
 */
export const resolveRailNavPanelKey = (
  pathname: string,
  activeWorkspaceSlug: string | null,
): string => {
  const legacyKey = resolveNavPanelKey(pathname, activeWorkspaceSlug);
  const [rootSegment] = splitRoute(pathname, activeWorkspaceSlug);

  if (legacyKey === 'home') {
    if (rootSegment === 'agents') return NAV_PANEL_CONTACTS_KEY;
    if (rootSegment && TASK_ROOTS.has(rootSegment)) return NAV_PANEL_TASKS_KEY;
    if (rootSegment && FULL_PAGE_ROOTS.has(rootSegment)) return NAV_PANEL_HIDDEN_KEY;
  }

  return legacyKey;
};

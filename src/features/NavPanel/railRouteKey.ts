import { resolveNavPanelKey } from './routeKey';

/**
 * Nav key for routes whose page owns the whole wrap (no list column). The rail
 * still highlights their tab; NavPanel renders nothing for this key.
 */
export const NAV_PANEL_HIDDEN_KEY = 'none';

/** The IM-style conversation list (agents + groups) behind the Messages tab. */
export const NAV_PANEL_MESSAGES_KEY = 'home';

/** The contacts list (agents + groups) behind the Contacts tab. */
export const NAV_PANEL_CONTACTS_KEY = 'contacts';

/**
 * Agent sub-pages that edit or describe the agent itself. They belong to the
 * Contacts tab (profile → edit), not to the conversation.
 */
const AGENT_CONTACT_PAGES = new Set([
  'channel',
  'permission',
  'profile',
  'self-evolving',
  'self-learning',
  'share',
  'statistics',
  'stats',
]);

/** Agent sub-pages that keep the agent's own sidebar (tasks, goals, topics). */
const AGENT_SIDEBAR_PAGES = new Set(['goal', 'goals', 'task', 'tasks', 'topics']);

const GROUP_CONTACT_PAGES = new Set(['permission', 'profile']);

const FULL_PAGE_ROOTS = new Set(['goal', 'goals', 'projects', 'task', 'tasks']);

/**
 * Nav key for the rail layout (rail + list column + content). Builds on the
 * legacy `resolveNavPanelKey`, which the mobile drawer still uses unchanged:
 * - agent / group chats share the conversation list (`home`);
 * - agent / group profile and config pages move to the Contacts list;
 * - tasks, goals and the project index render without a list column.
 */
export const resolveRailNavPanelKey = (
  pathname: string,
  activeWorkspaceSlug: string | null,
): string => {
  const legacyKey = resolveNavPanelKey(pathname, activeWorkspaceSlug);

  const segments = pathname.split('/').filter(Boolean);
  const isWorkspaceRoute =
    !!activeWorkspaceSlug && segments.length > 0 && segments[0] === activeWorkspaceSlug;
  const [rootSegment, , pageSegment] = isWorkspaceRoute ? segments.slice(1) : segments;

  if (legacyKey === 'agent') {
    if (pageSegment && AGENT_CONTACT_PAGES.has(pageSegment)) return NAV_PANEL_CONTACTS_KEY;
    if (pageSegment && AGENT_SIDEBAR_PAGES.has(pageSegment)) return 'agent';
    // The chat itself (index or `:topicId`) lives in the conversation list.
    return NAV_PANEL_MESSAGES_KEY;
  }

  if (legacyKey === 'group') {
    return pageSegment && GROUP_CONTACT_PAGES.has(pageSegment)
      ? NAV_PANEL_CONTACTS_KEY
      : NAV_PANEL_MESSAGES_KEY;
  }

  if (legacyKey === 'home') {
    if (rootSegment === 'agents') return NAV_PANEL_CONTACTS_KEY;
    if (rootSegment && FULL_PAGE_ROOTS.has(rootSegment)) return NAV_PANEL_HIDDEN_KEY;
  }

  return legacyKey;
};

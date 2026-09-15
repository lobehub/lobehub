import type { NavigateOptions } from 'react-router';

export interface WorkspaceAwareNavigateOptions extends NavigateOptions {
  /** When true, navigate to the literal `to` path without applying the workspace prefix. */
  escape?: boolean;
}

/**
 * Top-level path segments that are never mirrored under `/:workspaceSlug`.
 *
 * Kept in sync with `sharedMainAreaChildren` in the router configs. If you add
 * a new top-level personal-only route, append it here.
 *
 * `/settings` is handled separately via {@link WORKSPACE_SETTINGS_TABS} —
 * sub-paths in the allowlist get auto-prefixed; everything else (llm,
 * referral, system-tools, etc.) stays personal.
 */
const PERSONAL_PATH_REGEX =
  /^\/(?:apps|invite|onboarding|me|share|devtools|desktop-onboarding)(?:[/?#]|$)/;

const isPersonalPath = (to: string): boolean => PERSONAL_PATH_REGEX.test(to);

/**
 * Settings sub-paths that have a `/:workspaceSlug/settings/<tab>` mirror in
 * the SPA routers. Kept in sync with the workspace settings subtree in
 * `src/spa/router/desktopRouter.shared.tsx` and `mobileRouter.config.tsx`.
 *
 * Tabs absent from this set (llm, referral, system-tools, security, sync,
 * plugin, tts, agent, common, system-agent, memory, ...) are personal-only
 * and never prefixed.
 */
export const WORKSPACE_SETTINGS_TABS: ReadonlySet<string> = new Set([
  // About and the developer tools (advanced / labs) are user-level pages
  // mirrored under the workspace alongside the account-level tabs.
  'about',
  'advanced',
  'apikey',
  // Account-level tabs (profile / appearance / hotkey / messenger) are
  // mirrored under the workspace so members can reach them without leaving
  // the workspace.
  'appearance',
  'audit-log',
  'billing',
  'budget',
  'connector',
  'credential',
  // Legacy alias for `credential` — the routers keep a redirect, so prefixed
  // deep-links still land on `/:slug/settings/credential`.
  'creds',
  'credits',
  'devices',
  'general',
  'hotkey',
  'labels',
  'labs',
  'members',
  'messenger',
  'notification',
  'oauth-apps',
  'plans',
  'profile',
  'provider',
  'service-model',
  'skill',
  'statistics',
  // Legacy alias for `statistics` — the routers keep a redirect, so prefixed
  // deep-links still land on `/:slug/settings/statistics`.
  'stats',
  'storage',
  'usage',
]);

const SETTINGS_PREFIX_REGEX = /^\/settings\/([^/?#]+)/;
const FIRST_SEGMENT_REGEX = /^\/([^/?#]+)/;

const WORKSPACE_MIRRORED_FIRST_SEGMENTS = new Set([
  'agent',
  'agents',
  'community',
  'eval',
  'group',
  'image',
  'memory',
  'page',
  'project',
  'projects',
  'resource',
  'settings',
  'task',
  'tasks',
  'video',
]);

const parseFirstSegment = (pathname: string): string | null => {
  const match = pathname.match(FIRST_SEGMENT_REGEX);
  return match ? match[1] : null;
};

/**
 * Returns `true` for `/settings/<tab>` where `<tab>` is NOT in
 * {@link WORKSPACE_SETTINGS_TABS} (llm, referral, system-tools, …).
 * `/settings` index (or with query/hash) gets prefixed too — workspace
 * `/${slug}/settings` redirects to `/${slug}/settings/general`, personal
 * `/settings` redirects to `/settings/profile`.
 */
const isPersonalSettingsPath = (to: string): boolean => {
  const match = SETTINGS_PREFIX_REGEX.exec(to);
  if (!match) return false;
  return !WORKSPACE_SETTINGS_TABS.has(match[1]);
};

/**
 * Prefix an absolute path with `/${slug}` unless the path is already prefixed,
 * the path targets a personal-only surface, `escape` is set, or no active slug
 * exists. Returns the path unchanged when `to` is a relative path (so
 * `react-router` can resolve it itself).
 *
 * Pure function — extracted so it can be unit-tested without pulling in the
 * Zustand store / React tree.
 */
export const buildWorkspaceAwarePath = (
  to: string,
  activeSlug: string | null | undefined,
  options?: WorkspaceAwareNavigateOptions,
): string => {
  if (options?.escape) return to;
  if (!activeSlug) return to;
  if (!to.startsWith('/')) return to;
  if (isPersonalPath(to)) return to;
  if (isPersonalSettingsPath(to)) return to;
  if (to === `/${activeSlug}` || to.startsWith(`/${activeSlug}/`)) return to;

  const firstSegment = parseFirstSegment(to);
  if (firstSegment && !WORKSPACE_MIRRORED_FIRST_SEGMENTS.has(firstSegment)) return to;

  return `/${activeSlug}${to}`;
};

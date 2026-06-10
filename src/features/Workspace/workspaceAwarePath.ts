import type { NavigateOptions } from 'react-router-dom';

export interface WorkspaceAwareNavigateOptions extends NavigateOptions {
  /** When true, navigate to the literal `to` path without applying the workspace prefix. */
  escape?: boolean;
}

/**
 * Top-level path segments that are never mirrored under `/:workspaceSlug`.
 *
 * Kept in sync with `sharedMainAreaChildren` in the router configs and with
 * the `PERSONAL_PATH_REGEX` in `scripts/codemodWorkspaceNav.ts`. If you add
 * a new top-level personal-only route, append it here.
 *
 * `/settings` is handled separately via {@link WORKSPACE_SETTINGS_TABS} —
 * sub-paths in the allowlist get auto-prefixed; everything else (profile,
 * llm, referral, system-tools, etc.) stays personal.
 */
const PERSONAL_PATH_REGEX = /^\/(?:onboarding|me|share|devtools|desktop-onboarding)(?:[/?#]|$)/;

const isPersonalPath = (to: string): boolean => PERSONAL_PATH_REGEX.test(to);

/**
 * Settings sub-paths that have a `/:workspaceSlug/settings/<tab>` mirror in
 * the SPA routers. Kept in sync with the workspace settings subtree in
 * `src/spa/router/{desktopRouter.config,desktopRouter.config.desktop,mobileRouter.config}.tsx`
 * and with `SHARED_SETTINGS_TABS` in `scripts/codemodWorkspaceNav.ts`.
 *
 * Tabs absent from this set (profile, llm, referral, system-tools, security,
 * sync, plugin, tts, hotkey, agent, about, common, system-agent, ...) are
 * personal-only and never prefixed.
 */
export const WORKSPACE_SETTINGS_TABS: ReadonlySet<string> = new Set([
  'apikey',
  'billing',
  'creds',
  'credits',
  'general',
  'members',
  'messenger',
  'plans',
  'provider',
  'service-model',
  'skill',
  'stats',
  'usage',
]);

const SETTINGS_PREFIX_REGEX = /^\/settings\/([^/?#]+)/;

/**
 * Returns `true` for `/settings/<tab>` where `<tab>` is NOT in
 * {@link WORKSPACE_SETTINGS_TABS} (profile, llm, referral, system-tools, …).
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
  return `/${activeSlug}${to}`;
};

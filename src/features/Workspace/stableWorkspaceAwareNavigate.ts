import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { getStableNavigate } from '@/utils/stableNavigate';

import { buildWorkspaceAwarePath, type WorkspaceAwareNavigateOptions } from './workspaceAwarePath';

/**
 * Non-React counterpart of {@link useWorkspaceAwareNavigate}. Reads the active
 * workspace slug imperatively from the store and prefixes absolute path strings
 * before forwarding to the stable navigate ref. Use from store actions and other
 * non-component call sites where hooks are unavailable — otherwise creating an
 * entity inside a workspace navigates to the personal (unprefixed) route.
 *
 * Pass `{ escape: true }` to bypass prefixing for personal-only destinations.
 */
export const stableWorkspaceAwareNavigate = (
  to: string,
  options?: WorkspaceAwareNavigateOptions,
): void => {
  const navigate = getStableNavigate();
  if (!navigate) return;

  const activeSlug = getActiveWorkspaceSlug();
  const target = buildWorkspaceAwarePath(to, activeSlug, options);

  const { escape: _escape, ...rest } = options ?? {};
  void _escape;
  // Transparent drop-in: only forward a second arg when real options remain.
  if (Object.keys(rest).length > 0) navigate(target, rest);
  else navigate(target);
};

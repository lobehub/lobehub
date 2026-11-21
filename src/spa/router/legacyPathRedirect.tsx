'use client';

import { memo } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';

import { buildLegacyIntegrationPath } from '@/features/Integrations/connectorPage';
import { LEGACY_COMMUNITY_SEGMENT, MARKETPLACE_PATH } from '@/features/Marketplace/paths';

interface RedirectTargetOptions {
  hash?: string;
  search?: string;
  workspaceSlug?: string;
}

/**
 * Builds the destination of a retired URL. Unlike `redirectElement`, it keeps
 * the query and hash (`?open=mcp-connector:…`, `?skill=…`) so deep links keep
 * opening the same detail, and re-applies the `/:workspaceSlug` prefix the old
 * URL carried so the workspace scope is preserved.
 */
export const buildLegacyRedirectPath = (
  to: string,
  { hash = '', search = '', workspaceSlug }: RedirectTargetOptions = {},
): string => {
  const pathname = workspaceSlug ? `/${workspaceSlug}${to}` : to;

  return `${pathname}${search}${hash}`;
};

/**
 * `[/:slug]/community/<rest>` → `[/:slug]/marketplace/<rest>`, keeping the
 * trailing path. Reads the full pathname, so it works for every legacy route
 * shape (`community`, `community/agent/:slug`, `community/*`, …).
 */
export const buildLegacyCommunityRedirectPath = (
  pathname: string,
  options: RedirectTargetOptions = {},
): string => {
  const prefix = options.workspaceSlug ? `/${options.workspaceSlug}` : '';
  const root = `${prefix}/${LEGACY_COMMUNITY_SEGMENT}`;
  const rest = pathname.startsWith(root) ? pathname.slice(root.length).replace(/^\/+/, '') : '';

  return buildLegacyRedirectPath(rest ? `${MARKETPLACE_PATH}/${rest}` : MARKETPLACE_PATH, options);
};

/** Redirects a retired path to `to` (absolute, without the workspace prefix). */
export const LegacyPathRedirect = memo<{ to: string }>(({ to }) => {
  const { hash, search } = useLocation();
  const { workspaceSlug } = useParams();

  return <Navigate replace to={buildLegacyRedirectPath(to, { hash, search, workspaceSlug })} />;
});

LegacyPathRedirect.displayName = 'LegacyPathRedirect';

/**
 * The retired Integrations settings. GitHub and Linear moved onto their
 * Marketplace connectors; their install callbacks still return to these paths.
 */
export const LegacyIntegrationRedirect = memo(() => {
  const { hash, search } = useLocation();
  const { sub, workspaceSlug } = useParams();

  return (
    <Navigate
      replace
      to={buildLegacyRedirectPath(buildLegacyIntegrationPath(sub, search), { hash, workspaceSlug })}
    />
  );
});

LegacyIntegrationRedirect.displayName = 'LegacyIntegrationRedirect';

/** Mounted on the old `community/…` routes: forwards them to the Marketplace. */
export const LegacyCommunityRedirect = memo(() => {
  const { hash, pathname, search } = useLocation();
  const { workspaceSlug } = useParams();

  return (
    <Navigate
      replace
      to={buildLegacyCommunityRedirectPath(pathname, { hash, search, workspaceSlug })}
    />
  );
});

LegacyCommunityRedirect.displayName = 'LegacyCommunityRedirect';

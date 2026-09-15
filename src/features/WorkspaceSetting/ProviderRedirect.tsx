'use client';

import { Navigate, useParams } from 'react-router';

/**
 * Personal settings deep-links use the `/settings/provider/:providerId` path
 * shape, while the workspace provider page keeps the selected provider in the
 * `provider` query param. Workspace-prefixed deep-links in the path shape
 * (e.g. from `WorkspaceLink` / `useWorkspaceAwareNavigate` callsites) would
 * otherwise fall through to the catch-all route and kick the user out of the
 * workspace, so redirect them to the canonical query form.
 */
const WorkspaceProviderRedirect = () => {
  const { providerId = 'all', workspaceSlug } = useParams<{
    providerId: string;
    workspaceSlug: string;
  }>();

  return (
    <Navigate
      replace
      to={{
        pathname: `/${workspaceSlug}/settings/provider`,
        search: `?active=provider&provider=${encodeURIComponent(providerId)}`,
      }}
    />
  );
};

WorkspaceProviderRedirect.displayName = 'WorkspaceProviderRedirect';

export default WorkspaceProviderRedirect;

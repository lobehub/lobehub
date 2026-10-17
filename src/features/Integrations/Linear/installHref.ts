import urlJoin from 'url-join';

import { integrationInstallOrigin } from '@/utils/integrationInstallOrigin';

/** Where the OAuth callback sends the user back to. */
export const LINEAR_RETURN_TO = '/settings/integrations/linear';

interface LinearInstallHrefParams {
  /** Absolute origin of the LobeHub server that owns the install route. */
  appOrigin?: string;
  /** `null` outside a workspace; the id the connection should belong to inside one. */
  workspaceId?: string | null;
  /** `null` outside a workspace; the slug the return path is mirrored under. */
  workspaceSlug?: string | null;
}

/**
 * The "Connect Linear" target. Absolute for the same reason as GitHub's: on
 * desktop the renderer is not served from the server origin. The workspace
 * travels in the query because this is a full-page navigation, not a TRPC
 * call that would carry it in a header.
 */
export const buildLinearInstallHref = (
  installPath: string,
  { appOrigin, workspaceId, workspaceSlug }: LinearInstallHrefParams,
): string | undefined => {
  if (!appOrigin) return undefined;

  const query = new URLSearchParams({
    returnTo: workspaceSlug ? `/${workspaceSlug}${LINEAR_RETURN_TO}` : LINEAR_RETURN_TO,
  });
  if (workspaceId) query.set('workspaceId', workspaceId);

  return `${urlJoin(integrationInstallOrigin(appOrigin), installPath)}?${query}`;
};

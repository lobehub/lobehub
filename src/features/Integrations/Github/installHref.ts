import urlJoin from 'url-join';

/** Where the install callback sends the user back to. */
export const GITHUB_RETURN_TO = '/settings/integrations/github';

interface GithubInstallHrefParams {
  /** Absolute origin of the LobeHub server that owns the install route. */
  appOrigin?: string;
  /** `null` outside a workspace; the id the installation should bind to inside one. */
  workspaceId?: string | null;
  /** `null` outside a workspace; the slug the return path is mirrored under. */
  workspaceSlug?: string | null;
}

/**
 * The "Connect GitHub" target. Absolute on purpose: on desktop the renderer
 * lives on app://renderer and a relative link never reaches the server route.
 *
 * Both workspace facts travel in the query because this is a full-page
 * navigation, not a TRPC call: without `workspaceId` the callback binds the
 * installation to the installer's personal scope, and without the mirrored
 * `returnTo` the user lands back on the personal surface.
 */
export const buildGithubInstallHref = (
  installPath: string,
  { appOrigin, workspaceId, workspaceSlug }: GithubInstallHrefParams,
): string | undefined => {
  if (!appOrigin) return undefined;

  const query = new URLSearchParams({
    returnTo: workspaceSlug ? `/${workspaceSlug}${GITHUB_RETURN_TO}` : GITHUB_RETURN_TO,
  });
  if (workspaceId) query.set('workspaceId', workspaceId);

  return `${urlJoin(appOrigin, installPath)}?${query}`;
};

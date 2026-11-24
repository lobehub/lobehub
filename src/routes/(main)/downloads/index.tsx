import { Navigate } from 'react-router';

import DistributionDownloads from '@/features/Downloads/Distribution';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

/**
 * Installer downloads for this deployment.
 *
 * Upstream removed its own `/downloads` hub (#18318) — it advertised mobile
 * apps and messenger channels served from the hosted site, none of which a
 * self-hosted build ships. This page is NOT that hub: it lists only the
 * installers the deployment itself serves, from `desktopDownloads` in server
 * config.
 *
 * The route has to stay even though upstream dropped theirs: `/orgs/{slug}/downloads`
 * is a published address. The "get the desktop app" entries (`useDesktopDownload`)
 * link to the platform's public `/downloads` instead, which the deployment serves
 * outside this app so signed-out visitors can reach it.
 *
 * With nothing configured there is nothing to show, so redirect rather than
 * render an empty page: hiding the entry points while leaving the URL live is
 * the same half-measure as hiding a nav item with its route still mounted.
 */
const Downloads = () => {
  const urls = useServerConfigStore(serverConfigSelectors.desktopDownloads);

  if (!urls?.macOS && !urls?.windows && !urls?.linux) return <Navigate replace to={'/'} />;

  return <DistributionDownloads urls={urls} />;
};

export default Downloads;

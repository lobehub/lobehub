import type { LoaderFunctionArgs } from 'react-router';

import { getActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { getActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { parseWorkGalleryKey, type WorkGalleryKey } from '@/features/WorkGallery/const';
import { workspaceWorksParams } from '@/features/WorkGallery/hooks';
import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { workActions } from '@/store/work';

/**
 * The Work gallery filter a resource URL paints: the gallery
 * (`/resource/works?works=<key>`). Other Docs routes show no Works.
 */
export const galleryKeyOfUrl = (url: URL): WorkGalleryKey | null => {
  const segment = url.pathname.match(/\/resource(?:\/([^/]+))?\/?$/);
  // Only the Works gallery shows Works; the Docs home lists pages and files.
  if (segment?.[1] !== 'works') return null;
  return parseWorkGalleryKey(url.searchParams.get('works')) ?? 'all';
};

/**
 * Seed the persisted Work gallery head page for the filter the URL encodes.
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted list (an async read) can land before the page paints its loading
 * skeleton. The visibility is the persisted Private / Workspace mode the
 * resource sidebar restores for this workspace; the loader restores it into
 * the ResourceManager store first, so the page's first render reads the same
 * mode (and the same replica entry) instead of the store default.
 */
export const worksLoader = async ({ params, request }: LoaderFunctionArgs): Promise<null> => {
  const galleryKey = galleryKeyOfUrl(new URL(request.url));
  if (!galleryKey) return null;

  // A navigation into another workspace (or back to the personal space) runs
  // this loader before the destination commits and switches the scope, so the
  // active workspace and replica scope still describe the space being left.
  // Seeding them would read the wrong space; the page hydrates on mount once
  // the scope has switched.
  if ((params.workspaceSlug ?? null) !== getActiveWorkspaceSlug()) return null;

  const workspaceId = getActiveWorkspaceId();
  useResourceManagerStore.getState().hydrateListVisibility(workspaceId ?? undefined);
  const { listVisibility } = useResourceManagerStore.getState();

  await settleWithin(
    workActions.preHydrateWorkspaceWorks(
      workspaceWorksParams(galleryKey, workspaceId, listVisibility),
    ),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};

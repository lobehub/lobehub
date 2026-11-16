import type { RouteObject } from 'react-router';

import { redirectElement } from '@/utils/router';

/**
 * Marketplace sections that are hidden but not deleted yet.
 *
 * The Models and Model Providers sections were taken out of the Marketplace on
 * 2026-11-16: their nav entries are gone and their URLs redirect to the
 * Marketplace home, so bookmarks and shared links still land somewhere useful.
 *
 * The pages themselves are intentionally left in the repo, unregistered:
 * - `src/routes/(main)/community/(list)/{model,provider}`
 * - `src/routes/(main)/community/(detail)/{model,provider}`
 * - the `model` / `provider` slices of `src/store/discover`
 *
 * To bring a section back, register its list and detail routes again in
 * `desktopRouter.shared.tsx` and `mobileRouter.config.tsx` (see the git history
 * of those files) and restore its nav entry (`community/_layout/Sidebar/Header/Nav.tsx`,
 * `community/features/useNav.tsx`).
 *
 * TODO: once it is clear the sections are not coming back, delete the pages,
 * store slices, `discover` locale keys (`models.*`, `providers.*`) and this file.
 */
export const hiddenCommunityRoutes: RouteObject[] = [
  'model',
  'model/:slug',
  'provider',
  'provider/:slug',
].map((path) => ({ element: redirectElement('..'), path }));

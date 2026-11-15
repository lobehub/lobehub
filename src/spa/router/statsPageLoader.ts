import type { LoaderFunctionArgs } from 'react-router';

import { SettingsTabs } from '@/store/global/initialState';

/**
 * Route-table entries for the Settings → Stats pre-paint hydrate.
 *
 * The real loader imports the stats store. The route tables sit in the entry
 * chunk's static graph, so importing it directly would pull the store into the
 * first screen; resolving it on first use keeps it in the stats tab's lazy
 * chunks.
 */

/** For a route that only renders the stats tab (a static `stats` segment). */
export const statsPageLoader = () =>
  import('@/routes/(main)/settings/statsPageLoader').then((module) => module.statsPageLoader());

/** For the generic `:tab` route: only the stats tab has anything to seed. */
export const settingsTabLoader = ({ params }: LoaderFunctionArgs) =>
  params.tab === SettingsTabs.Stats ? statsPageLoader() : null;

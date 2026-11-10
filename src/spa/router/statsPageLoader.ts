import type { LoaderFunctionArgs } from 'react-router';

import { SettingsTabs } from '@/store/global/initialState';

/**
 * Route-table entry for the Settings → Stats pre-paint hydrate.
 *
 * The real loader imports the stats store. The route tables sit in the entry
 * chunk's static graph, so importing it directly would pull the store into the
 * first screen; resolving it on first use (and only for the stats tab) keeps it
 * in the stats tab's lazy chunks.
 */
export const statsPageLoader = async (args: LoaderFunctionArgs) => {
  if (args.params.tab !== SettingsTabs.Stats) return null;

  const module = await import('@/routes/(main)/settings/statsPageLoader');
  return module.statsPageLoader(args);
};

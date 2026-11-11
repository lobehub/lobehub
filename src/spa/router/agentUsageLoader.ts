import type { LoaderFunctionArgs } from 'react-router';

/**
 * Route-table entry for the agent usage tab pre-paint hydrate.
 *
 * The real loader imports the stats store. The route tables sit in the entry
 * chunk's static graph, so importing it directly would pull the store into the
 * first screen; resolving it on first use keeps it in the usage tab's lazy
 * chunks, which load in parallel with this one.
 */
export const agentUsageLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/agent/statistics/agentUsageLoader').then((module) =>
    module.agentUsageLoader(args),
  );

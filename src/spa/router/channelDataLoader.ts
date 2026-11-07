import type { LoaderFunctionArgs } from 'react-router';

/**
 * Route-table entry for the agent channel pre-paint hydrate.
 *
 * The real loader imports the agent store. The route tables sit in the entry
 * chunk's static graph, so importing it directly would pull the store into the
 * first screen; resolving it on first use keeps it in the channel route's lazy
 * chunks, which load in parallel with this one.
 */
export const channelDataLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/agent/channel/channelLoader').then((module) =>
    module.channelDataLoader(args),
  );

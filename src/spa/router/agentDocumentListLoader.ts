import type { LoaderFunctionArgs } from 'react-router';

/**
 * Route-table entry for the agent documents pre-paint hydrate.
 *
 * The real loader imports the agent document store. The route tables sit in the
 * entry chunk's static graph, so importing it directly would pull the store into
 * the first screen; resolving it on first use keeps it in the docs route's lazy
 * chunks, which load in parallel with this one.
 */
export const agentDocumentListLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/agent/docs/documentListLoader').then((module) =>
    module.agentDocumentListLoader(args),
  );

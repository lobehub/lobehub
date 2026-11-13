import type { LoaderFunctionArgs } from 'react-router';

// The route tables sit in the entry chunk's static graph; resolving the real
// loader on first use keeps the brief store out of it.
export const homeInboxLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/home/homeInboxLoader').then((module) => module.homeInboxLoader(args));

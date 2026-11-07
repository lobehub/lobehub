import type { LoaderFunctionArgs } from 'react-router';

// The route tables sit in the entry chunk's static graph; resolving the real
// loader on first use keeps the page store in the page route's lazy chunks.
export const pageListLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/page/pageListLoader').then((module) => module.pageListLoader(args));

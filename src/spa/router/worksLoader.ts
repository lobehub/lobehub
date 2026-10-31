import type { LoaderFunctionArgs } from 'react-router';

// The route tables sit in the entry chunk's static graph; resolving the real
// loader on first use keeps the work store in the resource route's lazy
// chunks. The request carries the gallery filter (`?works=`).
export const worksLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/resource/(home)/worksLoader').then((module) => module.worksLoader(args));

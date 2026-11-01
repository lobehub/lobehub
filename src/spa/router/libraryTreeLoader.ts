import type { LoaderFunctionArgs } from 'react-router';

// The route tables sit in the entry chunk's static graph; resolving the real
// loader on first use keeps the tree store in the library route's lazy chunks.
export const libraryTreeLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/resource/library/libraryTreeLoader').then((module) =>
    module.libraryTreeLoader(args),
  );

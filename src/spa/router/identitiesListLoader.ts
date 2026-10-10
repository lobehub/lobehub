// The route tables sit in the entry chunk's static graph; resolving the real
// loader on first use keeps the userMemory store in the identities route's lazy
// chunks.
export const identitiesListLoader = () =>
  import('@/routes/(main)/memory/identities/identitiesListLoader').then((module) =>
    module.identitiesListLoader(),
  );

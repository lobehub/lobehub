type RoutePreloadLoader = () => Promise<void>;

const preloadLoaders = new Map<string, Set<RoutePreloadLoader>>();

export const registerRoutePreloadLoader = (id: string, loader: RoutePreloadLoader) => {
  const loaders = preloadLoaders.get(id) ?? new Set<RoutePreloadLoader>();
  loaders.add(loader);
  preloadLoaders.set(id, loaders);
};

export const preloadRegisteredRoute = async (id: string) => {
  const loaders = preloadLoaders.get(id);
  if (!loaders) return;

  await Promise.all([...loaders].map((loader) => loader()));
};

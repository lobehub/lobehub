export const ensureBuiltinToolSurfaces = (): Promise<void> => Promise.resolve();

export const loadRouteWithBuiltinToolSurfaces = <T>(loadRoute: () => Promise<T>): Promise<T> =>
  loadRoute();

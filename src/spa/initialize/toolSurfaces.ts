let registrationPromise: Promise<void> | undefined;

/**
 * Loads the builtin render/inspector registry only when a conversation surface is needed.
 * The shared promise keeps idle preloading and route-demand loading idempotent.
 */
export const ensureBuiltinToolSurfaces = (): Promise<void> => {
  if (!registrationPromise) {
    registrationPromise = import('@lobechat/builtin-tools/register')
      .then(({ registerBuiltinToolSurfaces }) => {
        registerBuiltinToolSurfaces();
      })
      .catch((error) => {
        registrationPromise = undefined;
        throw error;
      });
  }

  return registrationPromise;
};

/**
 * Keeps a routed conversation suspended until its builtin tool surfaces are registered while
 * allowing the route module and the registry chunk to download in parallel.
 */
export const loadRouteWithBuiltinToolSurfaces = async <T>(
  loadRoute: () => Promise<T>,
): Promise<T> => {
  const [routeModule] = await Promise.all([loadRoute(), ensureBuiltinToolSurfaces()]);

  return routeModule;
};

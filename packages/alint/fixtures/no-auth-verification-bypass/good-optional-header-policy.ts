// Operator-configurable additional headers; by contract this guard is a no-op when unset.
export const optionalHeaderGuard = async (
  request: Request,
  configuredHeaders: Record<string, string> | undefined,
  next: () => Promise<void>,
) => {
  if (configuredHeaders) {
    for (const [key, value] of Object.entries(configuredHeaders)) {
      if (request.headers.get(key) !== value) throw new Error('Unauthorized');
    }
  }
  await next();
};

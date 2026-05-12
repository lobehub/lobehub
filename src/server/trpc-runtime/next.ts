import type { TRPCRouteId } from './runtime';
import { selectTRPCRuntime, withTRPCRuntimeHeaders } from './runtime';

type RouteHandler = (request: Request) => Promise<Response>;

export const createNextTRPCRouteHandler =
  (route: TRPCRouteId, nextHandler: RouteHandler): RouteHandler =>
  async (request) => {
    const selection = selectTRPCRuntime(request, route);
    const response =
      selection.runtime === 'hono'
        ? await (await import('@/server/trpc-hono')).default.fetch(request)
        : await nextHandler(request);

    return withTRPCRuntimeHeaders(response, selection);
  };

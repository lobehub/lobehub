import type { APIRouteId } from './runtime';
import { selectAPIRuntime, withAPIRuntimeHeaders } from './runtime';
import type { APIRouteHandler, APIRouteHandlerOptions } from './types';

const fetchHonoRuntime = async (
  request: Request,
  runtime: NonNullable<APIRouteHandlerOptions['honoRuntime']>,
) => {
  if (runtime === 'root') {
    return (await import('@/server/hono')).default.fetch(request);
  }

  return (await import('@/server/api-hono')).default.fetch(request);
};

export const createNextAPIRouteHandler =
  (
    route: APIRouteId,
    nextHandler: APIRouteHandler,
    options: APIRouteHandlerOptions = {},
  ): APIRouteHandler =>
  async (request) => {
    const selection = selectAPIRuntime(request, route);

    const response =
      selection.runtime === 'hono'
        ? await fetchHonoRuntime(request, options.honoRuntime ?? 'api')
        : await nextHandler(request);

    return withAPIRuntimeHeaders(response, selection);
  };

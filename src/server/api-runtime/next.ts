import { fetchHonoRuntime } from '@/server/hono-runtime/client';

import type { APIRouteId } from './runtime';
import { selectAPIRuntime, withAPIRuntimeHeaders } from './runtime';
import type { APIRouteHandler, APIRouteHandlerOptions } from './types';

export const createNextAPIRouteHandler =
  (
    route: APIRouteId,
    nextHandler: APIRouteHandler,
    _options: APIRouteHandlerOptions = {},
  ): APIRouteHandler =>
  async (request) => {
    const selection = selectAPIRuntime(request, route);

    const response =
      selection.runtime === 'hono' ? await fetchHonoRuntime(request) : await nextHandler(request);

    return withAPIRuntimeHeaders(response, selection);
  };

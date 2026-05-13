import { after } from 'next/server';

import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { traceAPIHandler } from '@/server/api-runtime/trace';

export const POST = createNextAPIRouteHandler(
  'webapi-trace',
  (request) =>
    traceAPIHandler(request, {
      scheduleAfterResponse: after,
    }),
  { honoRuntime: 'root' },
);

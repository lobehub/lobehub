import { after } from 'next/server';

import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { oidcCallbackDesktopAPIHandler } from '@/server/api-runtime/oidc';

export const GET = createNextAPIRouteHandler(
  'oidc-callback-desktop',
  (request) =>
    oidcCallbackDesktopAPIHandler(request, {
      scheduleAfterResponse: after,
    }),
  { honoRuntime: 'root' },
);

import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { oidcClearSessionAPIHandler } from '@/server/api-runtime/oidc';

export const POST = createNextAPIRouteHandler('oidc-clear-session', oidcClearSessionAPIHandler, {
  honoRuntime: 'root',
});

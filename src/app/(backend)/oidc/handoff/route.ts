import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { oidcHandoffAPIHandler } from '@/server/api-runtime/oidc';

export const GET = createNextAPIRouteHandler('oidc-handoff', oidcHandoffAPIHandler, {
  honoRuntime: 'root',
});

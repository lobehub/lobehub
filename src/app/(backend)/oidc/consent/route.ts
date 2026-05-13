import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { oidcConsentAPIHandler } from '@/server/api-runtime/oidc';

export const POST = createNextAPIRouteHandler('oidc-consent', oidcConsentAPIHandler, {
  honoRuntime: 'root',
});

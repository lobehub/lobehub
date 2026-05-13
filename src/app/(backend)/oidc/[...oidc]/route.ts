import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { oidcProviderAPIHandler } from '@/server/api-runtime/oidc';

const handler = createNextAPIRouteHandler('oidc-provider', oidcProviderAPIHandler, {
  honoRuntime: 'root',
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;

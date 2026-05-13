import { betterAuthAPIHandler } from '@/server/api-runtime/betterAuth';
import { createNextAPIRouteHandler } from '@/server/api-runtime/next';

const handler = createNextAPIRouteHandler('api-auth-all', betterAuthAPIHandler);

export const GET = handler;
export const POST = handler;

import { createNextAPIRouteHandler } from '@/server/api-runtime/next';
import { openAPIHandler } from '@/server/api-runtime/openapi';

const handler = createNextAPIRouteHandler('api-v1', openAPIHandler);

// Export all required HTTP method handlers
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const OPTIONS = handler;
export const HEAD = handler;

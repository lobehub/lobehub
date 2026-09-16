// Import the workspace source directly so Next.js/Turbopack bundles the OpenAPI
// package into the server function instead of leaving packages/openapi/src/app.js
// as an external ESM module at Vercel runtime.
import lobeOpenApi from '../../../../../../../packages/openapi/src';

const handler = (request: Request) => lobeOpenApi.fetch(request);

// Export all required HTTP method handlers
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const OPTIONS = handler;
export const HEAD = handler;

import lobeOpenApi from '@lobechat/openapi';

const handler = (request: Request) => lobeOpenApi.fetch(request);

// Export all required HTTP method handlers
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const OPTIONS = handler;
export const HEAD = handler;

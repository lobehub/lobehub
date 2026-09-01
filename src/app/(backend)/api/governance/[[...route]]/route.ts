import app from '@/server/router-hono/governance';

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;

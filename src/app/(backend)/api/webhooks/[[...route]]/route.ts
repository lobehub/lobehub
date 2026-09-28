import app from '@/server/router-hono/webhooks';

export const GET = (request: Request) => app.fetch(request);
export const POST = (request: Request) => app.fetch(request);

import app from '@/server/router-hono/webhooks';

export const POST = (request: Request) => app.fetch(request);

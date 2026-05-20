import app from '@/server/workflows-hono';

export const POST = (request: Request) => app.fetch(request);

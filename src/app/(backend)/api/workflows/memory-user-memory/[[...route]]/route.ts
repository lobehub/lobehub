import app from '@/server/workflows-hono/memory-user-memory/app';

export const POST = (request: Request) => app.fetch(request);

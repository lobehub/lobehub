import app from '@/server/router-hono/workflows';

export const POST = (request: Request) => app.fetch(request);

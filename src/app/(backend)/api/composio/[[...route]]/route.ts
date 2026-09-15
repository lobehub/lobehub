import app from '@/server/router-hono/composio';

export const GET = (request: Request) => app.fetch(request);

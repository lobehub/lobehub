import app from '@/server/router-hono/connectors';

export const GET = (request: Request) => app.fetch(request);

import app from '@/server/router-hono/device';

export const runtime = 'nodejs';

export const POST = (request: Request) => app.fetch(request);

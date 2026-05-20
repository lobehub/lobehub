import app from '@/server/agent-hono';

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;

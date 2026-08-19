import app from '@/server/router-hono/claudeCodeGateway';

const handler = (request: Request) => app.fetch(request);

export const POST = handler;

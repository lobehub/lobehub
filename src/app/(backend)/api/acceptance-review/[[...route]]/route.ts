import app from '@/server/router-hono/acceptance-review';

export const maxDuration = 300;
export const runtime = 'nodejs';

const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;

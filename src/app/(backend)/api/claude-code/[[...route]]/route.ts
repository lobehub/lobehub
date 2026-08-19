import app from '@/server/router-hono/claudeCodeGateway';

const handler = (request: Request) => app.fetch(request);

// Long-lived Anthropic SSE passthrough; Vercel defaults otherwise kill the stream.
export const maxDuration = 300;

export const POST = handler;

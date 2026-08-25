import app from '@/server/router-hono/trpc/tools';

const handler = (request: Request) => app.fetch(request);

export { handler as GET, handler as POST };

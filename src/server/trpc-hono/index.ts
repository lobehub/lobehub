import { Hono } from 'hono';

import { asyncTRPCHandler } from '@/server/trpc-runtime/async';
import { lambdaTRPCHandler } from '@/server/trpc-runtime/lambda';
import { mobileTRPCHandler } from '@/server/trpc-runtime/mobile';
import { toolsTRPCHandler } from '@/server/trpc-runtime/tools';

/**
 * Hono app for `/trpc/*` endpoints. It is intentionally mounted behind the
 * existing Next.js route files so production can gray-release between the
 * native Next tRPC path and this runtime without changing public URLs.
 */
const app = new Hono().basePath('/trpc');

app.all('/async/*', (c) => asyncTRPCHandler(c.req.raw));
app.all('/lambda/*', (c) => lambdaTRPCHandler(c.req.raw));
app.all('/mobile/*', (c) => mobileTRPCHandler(c.req.raw));
app.all('/tools/*', (c) => toolsTRPCHandler(c.req.raw));

export default app;

import { initTRPC } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import { createTRPCApp, createTRPCHandler } from './createHandler';

const trpc = initTRPC.context<{ requestUrl: string }>().create();
const testRouter = trpc.router({
  requestUrl: trpc.procedure.query(({ ctx }) => ctx.requestUrl),
});

describe('Hono tRPC handler', () => {
  it('serves a tRPC procedure through a Hono route', async () => {
    const handler = createTRPCHandler({
      createContext: async (request: Request) => ({ requestUrl: request.url }),
      endpoint: '/trpc/test',
      router: testRouter,
    });
    const app = createTRPCApp('/trpc/test', handler);

    const response = await app.request('http://localhost/trpc/test/requestUrl');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: { data: 'http://localhost/trpc/test/requestUrl' },
    });
  });
});

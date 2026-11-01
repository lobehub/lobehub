import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';

import type { LambdaRouter } from '@/server/routers/lambda';

export const createServerLambdaClient = (request: Request, apiBase?: string) =>
  createTRPCClient<LambdaRouter>({
    links: [
      httpLink({
        headers: () => {
          const cookie = request.headers.get('cookie');
          return cookie ? { cookie } : {};
        },
        transformer: superjson,
        url: new URL('/trpc/lambda', apiBase || request.url).toString(),
      }),
    ],
  });

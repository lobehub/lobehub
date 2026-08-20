import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';

import type { LambdaRouter } from '@/server/routers/lambda';

/** Expected signed-out share requests should degrade to client loading without noisy SSR logs. */
export const isUnauthorizedTRPCError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  return 'data' in error && error.data !== null && typeof error.data === 'object'
    ? 'code' in error.data && error.data.code === 'UNAUTHORIZED'
    : false;
};

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

import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';

import type { LambdaRouter } from '@/server/routers/lambda';

import { reject } from './reject';

export const lambdaClient = createTRPCClient<LambdaRouter>({
  links: [
    httpLink({
      fetch: (input, init) => fetch(input, { ...init, credentials: 'include' }),
      transformer: superjson,
      url: '/trpc/lambda',
    }),
  ],
});

export const asyncClient = reject('asyncClient');
export const toolsClient = reject('toolsClient');
export const lambdaQuery = reject('lambdaQuery');

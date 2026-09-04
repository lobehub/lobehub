import type { AnyRouter } from '@trpc/server';
import type { FetchCreateContextFn, FetchHandlerRequestOptions } from '@trpc/server/adapters/fetch';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { Hono } from 'hono';

import { prepareRequestForTRPC } from '@/libs/trpc/utils/request-adapter';

type CreateTRPCHandlerOptions<TRouter extends AnyRouter> = Omit<
  FetchHandlerRequestOptions<TRouter>,
  'createContext' | 'req'
> & {
  createContext: (request: Request) => ReturnType<FetchCreateContextFn<TRouter>>;
};

export const createTRPCHandler =
  <TRouter extends AnyRouter>({ createContext, ...options }: CreateTRPCHandlerOptions<TRouter>) =>
  (request: Request): Promise<Response> =>
    fetchRequestHandler({
      ...options,
      createContext: () => createContext(request),
      req: prepareRequestForTRPC(request),
    });

export const createTRPCApp = (basePath: string, handler: (request: Request) => Promise<Response>) =>
  new Hono().basePath(basePath).all('/*', (c) => handler(c.req.raw));

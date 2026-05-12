import type { AnyRouter } from '@trpc/server';
import type { FetchCreateContextFn, FetchHandlerRequestOptions } from '@trpc/server/adapters/fetch';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';

import { prepareRequestForTRPC } from '@/libs/trpc/utils/request-adapter';

type CreateTRPCRouteHandlerOptions<TRouter extends AnyRouter> = Omit<
  FetchHandlerRequestOptions<TRouter>,
  'createContext' | 'req'
> & {
  createContext: (request: Request) => ReturnType<FetchCreateContextFn<TRouter>>;
};

export const createTRPCRouteHandler =
  <TRouter extends AnyRouter>({
    createContext,
    ...options
  }: CreateTRPCRouteHandlerOptions<TRouter>) =>
  (request: Request): Promise<Response> =>
    fetchRequestHandler({
      ...options,
      createContext: () => createContext(request),
      req: prepareRequestForTRPC(request),
    });

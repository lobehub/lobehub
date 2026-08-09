import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { Hono } from 'hono';
import { NextRequest } from 'next/server';

import { router } from '@/libs/trpc/lambda';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { createTRPCErrorLogger } from '@/libs/trpc/utils/errorLogger';
import { prepareRequestForTRPC } from '@/libs/trpc/utils/request-adapter';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { platformAdminRouter } from '@/server/routers/lambda/platformAdmin';

/** Control-plane-only tRPC surface (platform admin + FX helper). */
export const controlPlaneRouter = router({
  platformAdmin: platformAdminRouter,
});

export type ControlPlaneRouter = typeof controlPlaneRouter;

export const createControlPlaneTrpcApp = () => {
  const app = new Hono();

  const handler = async (request: Request) => {
    const preparedReq = prepareRequestForTRPC(new NextRequest(request));
    return fetchRequestHandler({
      createContext: () => createLambdaContext(new NextRequest(request)),
      endpoint: '/trpc/lambda',
      onError: createTRPCErrorLogger('control-plane'),
      req: preparedReq,
      responseMeta: createResponseMeta,
      router: controlPlaneRouter,
    });
  };

  app.all('/', (c) => handler(c.req.raw));
  app.all('/*', (c) => handler(c.req.raw));

  return app;
};

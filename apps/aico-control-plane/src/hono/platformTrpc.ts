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
    // One NextRequest for auth context; clone the body stream for tRPC (same
    // pattern as src/app/(backend)/trpc/lambda/[trpc]/route.ts). Constructing
    // NextRequest twice from the same raw Request throws after the body is used.
    const nextReq = new NextRequest(request);
    const preparedReq = prepareRequestForTRPC(nextReq);
    return fetchRequestHandler({
      createContext: () => createLambdaContext(nextReq),
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

import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { createTRPCErrorLogger } from '@/libs/trpc/utils/errorLogger';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { lambdaRouter } from '@/server/routers/lambda';

import { createTRPCApp, createTRPCHandler } from './createHandler';

export const lambdaTRPCHandler = createTRPCHandler({
  allowMethodOverride: true,
  createContext: createLambdaContext,
  endpoint: '/trpc/lambda',
  onError: createTRPCErrorLogger('lambda'),
  responseMeta: createResponseMeta,
  router: lambdaRouter,
});

export default createTRPCApp('/trpc/lambda', lambdaTRPCHandler);

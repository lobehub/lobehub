import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { createTRPCErrorLogger } from '@/libs/trpc/utils/errorLogger';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { toolsRouter } from '@/server/routers/tools';

import { createTRPCApp, createTRPCHandler } from './createHandler';

export const toolsTRPCHandler = createTRPCHandler({
  createContext: createLambdaContext,
  endpoint: '/trpc/tools',
  onError: createTRPCErrorLogger('tools'),
  responseMeta: createResponseMeta,
  router: toolsRouter,
});

export default createTRPCApp('/trpc/tools', toolsTRPCHandler);

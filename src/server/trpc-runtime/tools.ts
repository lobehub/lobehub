import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { toolsRouter } from '@/server/routers/tools';

import { createTRPCRouteHandler } from './createTRPCRouteHandler';

export const toolsTRPCHandler = createTRPCRouteHandler({
  /**
   * @link https://trpc.io/docs/v11/context
   */
  createContext: createLambdaContext,
  endpoint: '/trpc/tools',
  onError: ({ error, path, type }) => {
    console.error(`Error in tRPC handler (tools) on path: ${path}, type: ${type}`);
    console.error(error);
  },
  responseMeta: createResponseMeta,
  router: toolsRouter,
});

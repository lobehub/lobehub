import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { mobileRouter } from '@/server/routers/mobile';

import { createTRPCRouteHandler } from './createTRPCRouteHandler';

export const mobileTRPCHandler = createTRPCRouteHandler({
  /**
   * @link https://trpc.io/docs/v11/context
   */
  createContext: createLambdaContext,
  endpoint: '/trpc/mobile',
  onError: ({ error, path, type }) => {
    console.info(`Error in tRPC handler (mobile) on path: ${path}, type: ${type}`);
    console.error(error);
  },
  responseMeta: createResponseMeta,
  router: mobileRouter,
});

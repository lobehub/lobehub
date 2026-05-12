import { createAsyncRouteContext } from '@/libs/trpc/async/context';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { asyncRouter } from '@/server/routers/async';

import { createTRPCRouteHandler } from './createTRPCRouteHandler';

export const asyncTRPCHandler = createTRPCRouteHandler({
  // Avoid interference between requests
  // https://github.com/lobehub/lobe-chat/discussions/7442#discussioncomment-13658563
  allowBatching: false,

  /**
   * @link https://trpc.io/docs/v11/context
   */
  createContext: createAsyncRouteContext,
  endpoint: '/trpc/async',
  onError: ({ error, path, type }) => {
    console.info(`Error in tRPC handler (async) on path: ${path}, type: ${type}`);
    console.error(error);
  },
  responseMeta: createResponseMeta,
  router: asyncRouter,
});

import { createAsyncRouteContext } from '@/libs/trpc/async/context';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { asyncRouter } from '@/server/routers/async';

import { createTRPCApp, createTRPCHandler } from './createHandler';

export const asyncTRPCHandler = createTRPCHandler({
  // Avoid interference between requests
  // https://github.com/lobehub/lobe-chat/discussions/7442#discussioncomment-13658563
  allowBatching: false,
  createContext: createAsyncRouteContext,
  endpoint: '/trpc/async',
  onError: ({ error, path, type }) => {
    console.info(`Error in tRPC handler (async) on path: ${path}, type: ${type}`);
    console.error(error);
  },
  responseMeta: createResponseMeta,
  router: asyncRouter,
});

export default createTRPCApp('/trpc/async', asyncTRPCHandler);

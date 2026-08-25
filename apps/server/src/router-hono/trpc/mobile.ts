import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { createTRPCErrorLogger } from '@/libs/trpc/utils/errorLogger';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { mobileRouter } from '@/server/routers/mobile';

import { createTRPCApp, createTRPCHandler } from './createHandler';

export const mobileTRPCHandler = createTRPCHandler({
  createContext: createLambdaContext,
  endpoint: '/trpc/mobile',
  onError: createTRPCErrorLogger('mobile'),
  responseMeta: createResponseMeta,
  router: mobileRouter,
});

export default createTRPCApp('/trpc/mobile', mobileTRPCHandler);

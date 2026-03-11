import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { type NextRequest } from 'next/server';

import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { prepareRequestForTRPC } from '@/libs/trpc/utils/request-adapter';
import { createResponseMeta } from '@/libs/trpc/utils/responseMeta';
import { toolsRouter } from '@/server/routers/tools';

const handler = (req: NextRequest) => {
  // Clone the request to avoid "Response body object should not be disturbed or locked" error
  // in Next.js 16 when the body stream has been consumed by Next.js internal mechanisms
  const preparedReq = prepareRequestForTRPC(req);

  return fetchRequestHandler({
    /**
     * @link https://trpc.io/docs/v11/context
     */
    createContext: () => createLambdaContext(req),

    endpoint: '/trpc/tools',

    onError: ({ error, path, type }) => {
      console.error(`Error in tRPC handler (tools) on path: ${path}, type: ${type}`);
      console.error(error);
    },

    req: preparedReq,
    responseMeta: createResponseMeta,
    router: toolsRouter,
  });
};

export { handler as GET, handler as POST };

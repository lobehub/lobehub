import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

import { withElectronProtocolIfElectron } from '@/const/protocol';
import { type ToolsRouter } from '@/server/routers/tools';

export const toolsClient = createTRPCClient<ToolsRouter>({
  links: [
    httpBatchLink({
      headers: async () => {
        // dynamic import to avoid circular dependency
        const { createHeaderWithAuth } = await import('@/services/_auth');

        return createHeaderWithAuth();
      },
      maxURLLength: 2083,
      transformer: superjson,
      url: withElectronProtocolIfElectron('/trpc/tools'),
    }),
  ],
});

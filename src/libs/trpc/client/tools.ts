import { createTRPCClient, httpBatchLink, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';

import { withElectronProtocolIfElectron } from '@/const/protocol';
import { type ToolsRouter } from '@/server/routers/tools';

// 401 error debouncing for market auth
let lastMarket401Time = 0;
const MIN_401_INTERVAL = 5000; // 5 seconds

// Error handling link for tools client
const errorHandlingLink: TRPCLink<ToolsRouter> = () => {
  return ({ op, next }) =>
    observable((observer) =>
      next(op).subscribe({
        complete: () => observer.complete(),
        error: async (err) => {
          const status = err.data?.httpStatus as number;

          // Check if this is a market API call with 401 error
          if (status === 401 && op.path.startsWith('market.')) {
            const now = Date.now();
            if (now - lastMarket401Time > MIN_401_INTERVAL) {
              lastMarket401Time = now;
              // Emit event for MarketAuthProvider to handle
              const { marketAuthEvents } = await import('@/layout/AuthProvider/MarketAuth/events');
              marketAuthEvents.emit('market-unauthorized', {
                path: op.path,
                timestamp: now,
              });
            }
          }

          observer.error(err);
        },
        next: (value) => observer.next(value),
      }),
    );
};

export const toolsClient = createTRPCClient<ToolsRouter>({
  links: [
    errorHandlingLink,
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

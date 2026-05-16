import { createTRPCClient, httpBatchLink, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';

import { withElectronProtocolIfElectron } from '@/const/protocol';
import { type ToolsRouter } from '@/server/routers/tools';
import { createHeaderWithAuth } from '@/services/_auth';

// 401 error debouncing for market auth
let lastMarket401Time = 0;
const MIN_401_INTERVAL = 5000; // 5 seconds
const isCustomDeploymentHost =
  typeof window !== 'undefined' && !/(?:\.|^)lobehub\.com$/.test(window.location.hostname);
const isMarketAuthDisabled =
  process.env.NEXT_PUBLIC_DISABLE_MARKET_AUTH === '1' || isCustomDeploymentHost;

const getAuthHeaders = async () => {
  try {
    return await createHeaderWithAuth();
  } catch (error) {
    // Never let auth-header resolution break page rendering.
    console.error('[toolsClient] failed to build auth headers:', error);
    return {};
  }
};

// Error handling link for tools client
const errorHandlingLink: TRPCLink<ToolsRouter> = () => {
  return ({ op, next }) =>
    observable((observer) =>
      next(op).subscribe({
        complete: () => observer.complete(),
        error: async (err) => {
          const status = err.data?.httpStatus as number;
          const code = err.data?.code as string;

          console.info('[toolsClient] Error:', {
            code,
            message: err.message,
            path: op.path,
            status,
          });

          // Check if this is a market API call with 401 error
          // UNAUTHORIZED tRPC code maps to HTTP 401
          const is401 = status === 401 || code === 'UNAUTHORIZED';
          if (is401 && op.path.startsWith('market.')) {
            if (isMarketAuthDisabled) {
              observer.error(err);
              return;
            }

            const now = Date.now();
            if (now - lastMarket401Time > MIN_401_INTERVAL) {
              lastMarket401Time = now;
              console.info('[toolsClient] Emitting market-unauthorized event for path:', op.path);
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
        return getAuthHeaders();
      },
      maxURLLength: 2083,
      transformer: superjson,
      url: withElectronProtocolIfElectron('/trpc/tools'),
    }),
  ],
});

import { type TRPCLink } from '@trpc/client';
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import debug from 'debug';
import { type ModelProvider } from 'model-bank';
import superjson from 'superjson';

import { withElectronProtocolIfElectron } from '@/const/protocol';
import { isDesktop } from '@/const/version';
import { type LambdaRouter } from '@/server/routers/lambda';
import { createHeaderWithAuth } from '@/services/_auth';
import { imageGenerationConfigSelectors } from '@/store/image/slices/generationConfig/selectors';
import { getImageStoreState } from '@/store/image/store';

const log = debug('lobe-image:lambda-client');
const isCustomDeploymentHost =
  typeof window !== 'undefined' && !/(?:\.|^)lobehub\.com$/.test(window.location.hostname);
const isMarketAuthDisabled =
  process.env.NEXT_PUBLIC_DISABLE_MARKET_AUTH === '1' || isCustomDeploymentHost;
const NON_RETRYABLE_ERROR_PATTERNS = [
  'S3 environment variables are not set completely',
  'Klavis API key is not configured on server',
  'Failed query:',
  'relation "',
  'does not exist',
];

// 401 error debouncing: prevent showing multiple login notifications in short time
let last401Time = 0;
let lastMarket401Time = 0;
const MIN_401_INTERVAL = 5000; // 5 seconds

const getAuthHeaders = async (provider?: ModelProvider) => {
  try {
    // Only include provider in JWT for image operations
    // For other operations (like knowledge base embedding), let server use its own config
    return await createHeaderWithAuth(provider ? { provider } : undefined);
  } catch (error) {
    // Never let auth-header resolution break page rendering.
    console.error('[lambdaClient] failed to build auth headers:', error);
    return {};
  }
};

const resolveImageProvider = async (): Promise<ModelProvider | undefined> => {
  if (location.pathname !== '/image') return;

  try {
    return imageGenerationConfigSelectors.provider(getImageStoreState()) as ModelProvider;
  } catch (error) {
    // Keep TRPC requests healthy even when optional provider preload fails.
    console.error('[lambdaClient] failed to resolve image provider:', error);
    return;
  }
};

// handle error
const errorHandlingLink: TRPCLink<LambdaRouter> = () => {
  return ({ op, next }) =>
    observable((observer) =>
      next(op).subscribe({
        complete: () => observer.complete(),
        error: async (err) => {
          // Check if this is an abort error and should be ignored
          const isAbortError =
            err.message.includes('aborted') ||
            err.name === 'AbortError' ||
            err.cause?.name === 'AbortError' ||
            err.message.includes('signal is aborted without reason');

          const showError = (op.context?.showNotification as boolean) ?? true;
          const status = err.data?.httpStatus as number;

          // Check if this is a market API call
          const isMarketApi = op.path.startsWith('market.');
          const isDeterministicServerError =
            status >= 500 &&
            NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => err.message?.includes(pattern));

          if (isDeterministicServerError) {
            err.meta = { ...err.meta, shouldRetry: false };
          }

          // Don't show notifications for abort errors
          if (showError && !isAbortError) {
            switch (status) {
              case 401: {
                if (isMarketApi) {
                  if (isMarketAuthDisabled) {
                    // Deployment override: bypass all market auth side-effects.
                    err.meta = { ...err.meta, shouldRetry: false };
                    break;
                  }

                  // Market API 401: emit event for MarketAuthProvider to handle
                  // Don't trigger LobeChat logout for market auth issues
                  const now = Date.now();
                  if (now - lastMarket401Time > MIN_401_INTERVAL) {
                    lastMarket401Time = now;
                    // Dynamically import to avoid circular dependencies
                    const { marketAuthEvents } =
                      await import('@/layout/AuthProvider/MarketAuth/events');
                    marketAuthEvents.emit('market-unauthorized', {
                      path: op.path,
                      timestamp: now,
                    });
                  }
                } else {
                  // Non-market 401: handle as before (LobeChat session expired)
                  const now = Date.now();
                  if (now - last401Time > MIN_401_INTERVAL) {
                    last401Time = now;
                    // Desktop app doesn't have the web auth routes like `/signin`,
                    // so skip the login redirect/notification there.
                    if (!isDesktop) {
                      const { getUserStoreState } = await import('@/store/user/store');
                      const { isSignedIn, logout } = getUserStoreState();
                      // If user is still marked as signed in but got 401,
                      // session is invalid - clear client state first
                      if (isSignedIn) {
                        await logout();
                      }
                      const { loginRequired } =
                        await import('@/components/Error/loginRequiredNotification');
                      loginRequired.redirect();
                    }
                  }
                }
                // Mark error as non-retryable to prevent SWR infinite retry loop
                err.meta = { ...err.meta, shouldRetry: false };
                break;
              }

              default: {
                console.error(err);
              }
            }
          }

          observer.error(err);
        },
        next: (value) => observer.next(value),
      }),
    );
};

// 2. Shared link options
const linkOptions = {
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    // Ensure credentials are included to send cookies (like mp_token)

    const fetchOptions: RequestInit = {
      ...init,
      credentials: 'include',
    };

    if (isDesktop) {
      const res = await fetch(input as string, fetchOptions);

      if (res) return res;
    }

    return await fetch(input, fetchOptions);
  },
  headers: async () => {
    // for image page, we need to get the provider from the store
    log('Getting provider from store for image page: %s', location.pathname);
    const provider = await resolveImageProvider();
    if (provider) {
      log('Getting provider from store for image page: %s', provider);
    }

    const headers = await getAuthHeaders(provider);
    log('Headers: %O', headers);
    return headers;
  },
  transformer: superjson,
  url: withElectronProtocolIfElectron('/trpc/lambda'),
};

// Procedures that should skip batching for faster initial load
const initialLoadProcedures = new Set(['user.getUserState', 'config.getGlobalConfig']);
const slowProcedures = new Set(['market.getAssistantList']);
const SKIP_BATCH_PROCEDURES = new Set([...initialLoadProcedures, ...slowProcedures]);

// 3. splitLink to conditionally disable batching
const customSplitLink = splitLink({
  condition: (op) => SKIP_BATCH_PROCEDURES.has(op.path),
  false: httpBatchLink({ ...linkOptions, maxURLLength: 2083 }),
  true: httpLink(linkOptions),
});

// 4. assembly links
const links = [errorHandlingLink, customSplitLink];

export const lambdaClient = createTRPCClient<LambdaRouter>({
  links,
});

export const lambdaQuery = createTRPCReact<LambdaRouter>();

export const lambdaQueryClient = lambdaQuery.createClient({ links });

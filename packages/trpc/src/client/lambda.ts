import { type TRPCLink } from '@trpc/client';
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
import { createTRPCReact } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import debug from 'debug';
import { type ModelProvider } from 'model-bank';
import superjson from 'superjson';

import { isDesktop } from '@/const/version';
import { type LambdaRouter } from '@/server/routers/lambda';

const log = debug('lobe-image:lambda-client');

// 401 error debouncing: prevent showing multiple login notifications in short time
let last401Time = 0;
let lastMarket401Time = 0;
const MIN_401_INTERVAL = 5000; // 5 seconds

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

          // Don't show notifications for abort errors
          if (showError && !isAbortError) {
            switch (status) {
              case 401: {
                if (isMarketApi) {
                  // Market API 401: emit event for MarketAuthProvider to handle
                  // Don't trigger LobeChat logout for market auth issues
                  const { getUserStoreState } = await import('@/store/user/store');
                  // Without a LobeChat session a market.* 401 is not a Market auth
                  // issue — let it bubble instead of triggering the auth modal
                  if (!getUserStoreState().isSignedIn) break;
                  const now = Date.now();
                  if (now - lastMarket401Time > MIN_401_INTERVAL) {
                    lastMarket401Time = now;
                    // Dynamically import to avoid circular dependencies
                    const { marketAuthEvents } =
                      await import('@/layout/AuthProvider/MarketAuth/events');
                    const { pathToMarketAuthScene } =
                      await import('@/layout/AuthProvider/MarketAuth/scenes');
                    marketAuthEvents.emit('market-unauthorized', {
                      path: op.path,
                      scene: pathToMarketAuthScene(op.path),
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
    return fetch(input, { ...init, credentials: 'include' });
  },
  headers: async () => {
    // dynamic import to avoid circular dependency
    const { createHeaderWithAuth } = await import('@/services/_auth');

    let provider: ModelProvider | undefined;
    // for image page, we need to get the provider from the store
    log('Getting provider from store for image page: %s', location.pathname);
    if (location.pathname === '/image') {
      const { getImageStoreState } = await import('@/store/image');
      const { imageGenerationConfigSelectors } =
        await import('@/store/image/slices/generationConfig/selectors');
      provider = imageGenerationConfigSelectors.provider(getImageStoreState()) as ModelProvider;
      log('Getting provider from store for image page: %s', provider);
    }

    // Only include provider in JWT for image operations
    // For other operations (like knowledge base embedding), let server use its own config
    const headers = await createHeaderWithAuth(provider ? { provider } : undefined);

    // Let business layer contribute extra headers (e.g. workspace context in Cloud).
    // Community ships an empty stub at this slot.
    const { getBusinessTrpcHeaders } = await import('@/business/client/trpc-headers');
    Object.assign(headers as Record<string, string>, await getBusinessTrpcHeaders());

    log('Headers: %O', headers);
    return headers;
  },
  transformer: superjson,
  url: '/trpc/lambda',
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

/**
 * A lambda client pinned to an EXPLICIT workspace scope. The default
 * `lambdaClient` resolves its workspace context from the business headers slot
 * (the currently-active workspace); flows that target a workspace the user is
 * not currently in — e.g. sharing a personal device into a chosen workspace
 * from the personal settings page — pin the workspace header per client
 * instead. The override runs after the business headers merge, so it wins.
 */
export const createWorkspaceLambdaClient = (workspaceId: string) => {
  const scopedLinkOptions = {
    ...linkOptions,
    headers: async () => ({
      ...(await linkOptions.headers()),
      // Same contract as the cloud business headers slot / the server's
      // `WORKSPACE_ID_HEADER` (src/app/(backend)/webapi/_utils/workspace.ts).
      'X-Workspace-Id': workspaceId,
    }),
  };
  return createTRPCClient<LambdaRouter>({
    links: [
      errorHandlingLink,
      splitLink({
        condition: (op) => SKIP_BATCH_PROCEDURES.has(op.path),
        false: httpBatchLink({ ...scopedLinkOptions, maxURLLength: 2083 }),
        true: httpLink(scopedLinkOptions),
      }),
    ],
  });
};

export const lambdaQuery = createTRPCReact<LambdaRouter>();

export const lambdaQueryClient = lambdaQuery.createClient({ links });

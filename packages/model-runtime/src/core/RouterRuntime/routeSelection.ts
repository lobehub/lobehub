import type { ModelPricingContext, RouterRuntimeRequestContext } from '@lobechat/types';
import { AgentRuntimeErrorType } from '@lobechat/types';
import debug from 'debug';

import type { VideoPollingRoute } from '../../types';
import { AgentRuntimeError } from '../../utils/createError';
import { getDurationMs } from '../../utils/timing';
import type { ApiType } from './apiTypes';
import type {
  CreateRouterRuntimeOptions,
  LobeClientOptions,
  RouterInstance,
  RouterOptionItem,
  RouterRuntimeMethod,
  Routers,
} from './routerOptions';
import type { RouterTracer } from './tracer';

const log = debug('lobe-model-runtime:router-runtime');

/** What the routing helpers read from a router runtime; rebuilt per call from its current state. */
export interface RouterRuntimeDeps {
  id: string;
  options: LobeClientOptions & Record<string, any>;
  params: Omit<CreateRouterRuntimeOptions, 'apiKey' | 'id' | 'models' | 'routers'> &
    Record<string, any>;
  routers: Routers;
  trace: RouterTracer;
}

export interface RouteAttemptContext {
  allowedApiTypes?: ReadonlySet<ApiType>;
  metadata?: Record<string, unknown>;
  method: RouterRuntimeMethod;
  /** Skip routing and fallback: only the route's router/channel may serve the request. */
  pinnedRoute?: VideoPollingRoute;
  pricingContext?: ModelPricingContext;
  toolsCount?: number;
  user?: string;
}

/**
 * Resolve routers configuration and validate
 */
export const resolveRouters = async (
  deps: RouterRuntimeDeps,
  runtimeContext: RouterRuntimeRequestContext = {},
): Promise<RouterInstance[]> => {
  const startedAt = Date.now();
  const { model } = runtimeContext;
  try {
    const resolvedRouters =
      typeof deps.routers === 'function'
        ? await deps.routers(deps.options, runtimeContext)
        : deps.routers;

    deps.trace(
      'resolveRouters done model=%s durationMs=%d routerCount=%d dynamic=%s',
      model,
      getDurationMs(startedAt),
      resolvedRouters.length,
      typeof deps.routers === 'function',
    );

    if (resolvedRouters.length === 0) {
      throw AgentRuntimeError.chat({
        error: { message: 'empty providers' },
        errorType: AgentRuntimeErrorType.NoAvailableProvider,
        provider: deps.id,
      });
    }

    return resolvedRouters;
  } catch (error) {
    deps.trace('resolveRouters error model=%s durationMs=%d', model, getDurationMs(startedAt));
    throw error;
  }
};

export const resolveMatchedRouter = async (
  deps: RouterRuntimeDeps,
  model: string,
  pricingContext?: ModelPricingContext,
): Promise<RouterInstance> => {
  const startedAt = Date.now();
  const resolvedRouters = await resolveRouters(deps, {
    model,
    ...(pricingContext ? { pricingContext } : {}),
  });
  const baseURL = deps.options.baseURL;

  // Priority 1: Match by baseURLPattern (RegExp only)
  if (baseURL) {
    const baseURLMatch = resolvedRouters.find((router) => router.baseURLPattern?.test(baseURL));
    if (baseURLMatch) {
      deps.trace(
        'resolveMatchedRouter done model=%s match=baseURL routerId=%s apiType=%s durationMs=%d',
        model,
        baseURLMatch.id,
        baseURLMatch.apiType,
        getDurationMs(startedAt),
      );
      return baseURLMatch;
    }
  }

  // Priority 2: Match by models
  const modelMatch = resolvedRouters.find((router) => {
    if (router.models && router.models.length > 0) {
      return router.models.includes(model);
    }
    return false;
  });
  if (modelMatch) {
    deps.trace(
      'resolveMatchedRouter done model=%s match=models routerId=%s apiType=%s durationMs=%d',
      model,
      modelMatch.id,
      modelMatch.apiType,
      getDurationMs(startedAt),
    );
    return modelMatch;
  }

  // Fallback: Use the last router
  const fallbackRouter = resolvedRouters.at(-1)!;
  deps.trace(
    'resolveMatchedRouter done model=%s match=fallback routerId=%s apiType=%s durationMs=%d',
    model,
    fallbackRouter.id,
    fallbackRouter.apiType,
    getDurationMs(startedAt),
  );
  return fallbackRouter;
};

export const normalizeRouterOptions = (
  deps: RouterRuntimeDeps,
  router: RouterInstance,
): RouterOptionItem[] => {
  const startedAt = Date.now();
  const routerOptions = Array.isArray(router.options) ? router.options : [router.options];

  if (routerOptions.length === 0 || routerOptions.some((optionItem) => !optionItem)) {
    throw new Error('empty provider options');
  }

  deps.trace(
    'normalizeRouterOptions done routerId=%s options=%d durationMs=%d',
    router.id,
    routerOptions.length,
    getDurationMs(startedAt),
  );

  return routerOptions;
};

export const applySortRouterOptions = async (
  deps: RouterRuntimeDeps,
  router: RouterInstance,
  model: string,
  routerOptions: RouterOptionItem[],
  routeContext: RouteAttemptContext,
): Promise<RouterOptionItem[]> => {
  if (!deps.params.sortRouterOptions || routerOptions.length <= 1) return routerOptions;

  const startedAt = Date.now();
  try {
    // Hand the hook a copy: hooks may sort in place (`options.sort(...)`), and the
    // input can be the shared `router.options` array reused across concurrent
    // requests. Keeping the original untouched also keeps it a trustworthy
    // baseline — validating a same-reference return would always pass, even
    // after mutations like `options.pop()`.
    const sorted = await deps.params.sortRouterOptions({
      metadata: routeContext.metadata,
      method: routeContext.method,
      model,
      options: [...routerOptions],
      routerId: router.id,
      userId:
        (typeof deps.options.userId === 'string' ? deps.options.userId : undefined) ||
        routeContext.user,
    });
    const isPermutation =
      Array.isArray(sorted) &&
      sorted.length === routerOptions.length &&
      routerOptions.every((optionItem) => sorted.includes(optionItem));

    deps.trace(
      'sortRouterOptions done model=%s routerId=%s durationMs=%d applied=%s',
      model,
      router.id,
      getDurationMs(startedAt),
      isPermutation,
    );

    // Copy again so a hook retaining its returned array cannot mutate the
    // list while runWithFallback awaits provider calls between attempts.
    if (isPermutation) return [...sorted];

    log('sortRouterOptions returned a non-permutation result, ignoring');
    return routerOptions;
  } catch (error) {
    deps.trace(
      'sortRouterOptions error model=%s routerId=%s durationMs=%d',
      model,
      router.id,
      getDurationMs(startedAt),
    );
    log('sortRouterOptions callback error: %O', error);
    return routerOptions;
  }
};

/**
 * Resolve the exact router/channel that created a video instead of re-running normal
 * routing: stateful providers such as Gemini Omni scope the interaction to the creating
 * API key, so another channel's key can neither read nor continue it. Fail loudly when
 * that route disappears rather than silently switching keys.
 */
export const resolvePinnedRoute = async (
  deps: RouterRuntimeDeps,
  model: string | undefined,
  route?: VideoPollingRoute,
) => {
  if (!route?.routerId && !route?.channelId) return;

  const resolvedRouters = await resolveRouters(deps, { model });
  const router = route.routerId
    ? resolvedRouters.find((item) => item.id === route.routerId)
    : resolvedRouters.find((item) =>
        normalizeRouterOptions(deps, item).some((option) => option.id === route.channelId),
      );

  if (!router) {
    throw new Error('The video generation route is no longer available');
  }

  const routerOptions = normalizeRouterOptions(deps, router);
  const option = route.channelId
    ? routerOptions.find((item) => item.id === route.channelId)
    : routerOptions[0];

  if (!option) {
    throw new Error('The video generation channel is no longer available');
  }

  return { option, router };
};

/**
 * Pick the router and the ordered channels that may serve a request: the pinned
 * route when one is given, otherwise the matched router's eligible channels in
 * the order `sortRouterOptions` chose.
 */
export const selectRouteOptions = async (
  deps: RouterRuntimeDeps,
  model: string,
  routeContext: RouteAttemptContext,
) => {
  const { allowedApiTypes, pinnedRoute, pricingContext } = routeContext;
  const pinned = await resolvePinnedRoute(deps, model, pinnedRoute);
  const matchedRouter = pinned?.router ?? (await resolveMatchedRouter(deps, model, pricingContext));
  const eligibleRouterOptions = normalizeRouterOptions(deps, matchedRouter).filter(
    (option) => !allowedApiTypes || allowedApiTypes.has(option.apiType ?? matchedRouter.apiType),
  );
  if (eligibleRouterOptions.length === 0) {
    throw new TypeError(`No provider route supports raw audio input for model ${model}`);
  }
  const routerOptions = pinned
    ? [pinned.option]
    : await applySortRouterOptions(deps, matchedRouter, model, eligibleRouterOptions, routeContext);

  return { matchedRouter, routerOptions };
};

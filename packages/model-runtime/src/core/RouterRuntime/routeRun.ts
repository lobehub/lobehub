import debug from 'debug';
import { nanoid } from 'nanoid';

import { getDurationMs } from '../../utils/timing';
import type { LobeRuntimeAI } from '../BaseAI';
import type { ApiType } from './apiTypes';
import { attachRouteAttemptMetadata, validateRouteAttemptContext } from './attemptContext';
import { classifyAttemptError } from './attemptErrors';
import { createRuntimeFromOption } from './optionRuntime';
import type { RouteAttemptResult, RouteAttemptStart } from './routeAttempt';
import type { RouteRequestTasks } from './routeRequestTasks';
import type { RouterInstance, RouterOptionItem, RouteSuccessParams } from './routerOptions';
import type { RouteAttemptContext, RouterRuntimeDeps } from './routeSelection';

const log = debug('lobe-model-runtime:router-runtime');

export interface PreparedRouteAttempt {
  apiType: ApiType;
  attempt: RouteAttemptStart;
  channelId?: string;
  optionItem: RouterOptionItem;
  remark?: string;
  runtime: LobeRuntimeAI;
  userId?: string;
}

interface CreateRouteRunParams {
  deps: RouterRuntimeDeps;
  matchedRouter: RouterInstance;
  model: string;
  /** The router's own id, reported as `providerId` on every attempt. */
  providerId: string;
  /** Always report `routeRequestManaged` on attempts, `false` when no task tracks the request. */
  reportRouteRequestManaged?: boolean;
  routeContext: RouteAttemptContext;
  routerOptions: RouterOptionItem[];
  /** Request-scoped task tracking for hook work that must finish with the request. */
  routeTasks?: RouteRequestTasks;
  signal?: AbortSignal;
}

/**
 * The lifecycle shared by every attempt of one routed request: preparing a channel's
 * runtime, reporting the attempt, deciding whether a failure may fall back to the next
 * channel, and reporting the route that served it. Callers decide when an attempt commits.
 */
export const createRouteRun = ({
  deps,
  matchedRouter,
  model,
  providerId,
  reportRouteRequestManaged,
  routeContext,
  routerOptions,
  routeTasks,
  signal,
}: CreateRouteRunParams) => {
  const hooks = deps.params;
  const requestId = nanoid();
  const { metadata, toolsCount, user } = routeContext;
  const firstChannelId = routerOptions[0]?.id;
  const weighted = routerOptions.some((option) => option.weight !== undefined);

  const prepareAttempt = async (optionIndex: number): Promise<PreparedRouteAttempt> => {
    const optionItem = routerOptions[optionIndex];
    const {
      channelId,
      id: apiType,
      remark,
      runtime,
    } = await createRuntimeFromOption(deps, matchedRouter, optionItem);
    const userId = validateRouteAttemptContext(deps, {
      apiType,
      channelId,
      metadata,
      method: routeContext.method,
      model,
      routerId: matchedRouter.id,
      toolsCount,
      user,
    });
    const attempt: RouteAttemptStart = {
      apiType,
      attemptId: nanoid(),
      channelId,
      metadata: metadata ? { ...metadata } : undefined,
      model,
      optionIndex,
      providerId,
      remark,
      requestId,
      ...(reportRouteRequestManaged ? { routeRequestManaged: Boolean(routeTasks) } : {}),
      routerId: matchedRouter.id,
      // Exclude lazy runtime construction from provider performance measurements.
      startedAt: Date.now(),
      userId,
    };

    return { apiType, attempt, channelId, optionItem, remark, runtime, userId };
  };

  const reportAttempt = (
    attempt: RouteAttemptStart,
    result: Partial<RouteAttemptResult> & Pick<RouteAttemptResult, 'durationMs' | 'success'>,
  ) => {
    if (!hooks.onRouteAttempt) return;
    try {
      const task = hooks.onRouteAttempt({ ...attempt, ...result } as RouteAttemptResult);
      if (routeTasks) routeTasks.track(task);
      else task.catch((error) => log('onRouteAttempt callback error: %O', error));
    } catch (error) {
      log('onRouteAttempt callback error: %O', error);
    }
  };

  const reportFailure = (
    { attempt }: PreparedRouteAttempt,
    error: unknown,
    { completionPending }: { completionPending?: boolean } = {},
  ) => {
    const { nonRetryable, nonRetryableReason } = classifyAttemptError(error);
    reportAttempt(attempt, {
      ...(completionPending === undefined ? {} : { completionPending }),
      durationMs: Date.now() - attempt.startedAt,
      error,
      nonRetryable,
      nonRetryableReason,
      success: false,
    });
  };

  /** Whether a failed attempt may hand the request to the next channel. */
  const shouldContinueAfterError = async (error: unknown, optionIndex: number) => {
    // A cancelled request must not be replayed on the remaining channels.
    if (signal?.aborted) return false;
    if (classifyAttemptError(error).nonRetryable) return false;

    const startedAt = Date.now();
    try {
      const shouldStop = await hooks.shouldStopFallback?.({
        error,
        metadata,
        model,
        optionIndex,
      });
      deps.trace(
        'shouldStopFallback done model=%s attempt=%d/%d durationMs=%d shouldStop=%s traceId=%s',
        model,
        optionIndex + 1,
        routerOptions.length,
        getDurationMs(startedAt),
        shouldStop,
        metadata?.traceId,
      );
      return !shouldStop;
    } catch (fallbackError) {
      log('shouldStopFallback callback error: %O', fallbackError);
      return true;
    }
  };

  const attachSuccessMetadata = (
    { apiType, attempt, channelId }: PreparedRouteAttempt,
    { completionPending, durationMs }: { completionPending?: boolean; durationMs: number },
  ) =>
    attachRouteAttemptMetadata(deps, metadata, {
      apiType,
      attemptId: attempt.attemptId,
      channelId,
      ...(completionPending ? { completionPending } : {}),
      durationMs,
      optionIndex: attempt.optionIndex,
      providerId,
      requestId,
      routerId: matchedRouter.id,
      success: true,
      totalOptions: routerOptions.length,
    });

  /** Report the channel that served the request. Never turns a success into a failure. */
  const notifyRouteSuccess = async (
    { channelId, optionItem, userId }: PreparedRouteAttempt,
    extra: Pick<RouteSuccessParams, 'routeRequestManaged' | 'trackDeferredWork'> = {},
  ) => {
    if (!hooks.onRouteSuccess) return;

    try {
      /** Report failures here so the request tracker only waits for the handled task. */
      const task = Promise.resolve(
        hooks.onRouteSuccess({
          channelId,
          channelWeight: optionItem.weight,
          firstChannelId,
          method: routeContext.method,
          model,
          routerId: matchedRouter.id,
          ...extra,
          userId,
          weighted,
        }),
      ).catch((error) => {
        // Affinity storage must not turn a successful upstream response into a fallback.
        console.error('[RouterRuntime] onRouteSuccess callback failed:', error);
      });
      routeTasks?.track(task);
      await task;
    } catch (error) {
      console.error('[RouterRuntime] onRouteSuccess callback failed:', error);
    }
  };

  return {
    attachSuccessMetadata,
    notifyRouteSuccess,
    prepareAttempt,
    reportAttempt,
    reportFailure,
    requestId,
    shouldContinueAfterError,
  };
};

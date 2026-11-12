/** @see https://github.com/lobehub/lobe-chat/discussions/6563 */
import type { ModelPricingContext } from '@lobechat/types';
import debug from 'debug';

import type {
  ASROptions,
  ASRPayload,
  ChatMethodOptions,
  ChatStreamPayload,
  CreateImageMethodOptions,
  CreateImagePayload,
  CreateVideoMethodOptions,
  CreateVideoPayload,
  DecisionOptions,
  DecisionPayload,
  DecisionQuestions,
  EmbeddingsOptions,
  EmbeddingsPayload,
  GenerateObjectOptions,
  GenerateObjectPayload,
  HandleCreateVideoWebhookPayload,
  TextToSpeechOptions,
  TextToSpeechPayload,
  VideoPollingRoute,
} from '../../types';
import { postProcessModelList } from '../../utils/postProcessModelList';
import { getDurationMs } from '../../utils/timing';
import { createVideoWithCompletionMode } from '../../utils/videoCompletionMode';
import type { LobeRuntimeAI } from '../BaseAI';
import type { ApiType } from './apiTypes';
import { withAttemptUsage } from './attemptIdentity';
import { getChatAttemptObservation, observeChatAttempt } from './chatAttempt';
import { createChatAttemptFallbackCheck, resolveHoldReasoning } from './chatFallbackHooks';
import type { ChatStreamFallbackAttempt } from './chatStreamFallback';
import { createChatStreamFallbackResponse } from './chatStreamFallback';
import { runDecision } from './decisionRuntime';
import { createRuntimeFromOption } from './optionRuntime';
import type { RouteAttemptStart } from './routeAttempt';
import { createRouteRequestTasks } from './routeRequestTasks';
import type {
  CreateRouterRuntimeOptions,
  LobeClientOptions,
  RouterInstance,
  Routers,
} from './routerOptions';
import { createRouteRun } from './routeRun';
import {
  normalizeRouterOptions,
  resolveMatchedRouter,
  resolvePinnedRoute,
  resolveRouters,
  type RouteAttemptContext,
  type RouterRuntimeDeps,
  selectRouteOptions,
} from './routeSelection';
import { createRouterTracer, type RouterTracer } from './tracer';

export type { RouteAttemptResult } from './routeAttempt';
export type {
  CreateRouterRuntimeOptions,
  RouterRuntimeMethod,
  RouteSuccessParams,
  SortRouterOptionsParams,
} from './routerOptions';

const log = debug('lobe-model-runtime:router-runtime');

const RAW_AUDIO_API_TYPES = new Set<ApiType>(['google', 'openai', 'vertexai', 'xiaomimimo']);

const hasRawAudioInput = (payload: ChatStreamPayload) =>
  payload.messages.some(
    (message) =>
      Array.isArray(message.content) && message.content.some((part) => part.type === 'audio_url'),
  );

export const createRouterRuntime = ({
  id,
  routers,
  apiKey: DEFAULT_API_KEY,
  models: modelsOption,
  ...params
}: CreateRouterRuntimeOptions) => {
  return class UniformRuntime implements LobeRuntimeAI {
    public _options: LobeClientOptions & Record<string, any>;
    orchestratesVideoGenerationCompletion = true;
    private _routers: Routers;
    private _params: any;
    private _id: string;
    private trace: RouterTracer;

    /** What the routing helpers read; built per call so it always reflects current state. */
    private get deps(): RouterRuntimeDeps {
      return {
        id: this._id,
        options: this._options,
        params: this._params,
        routers: this._routers,
        trace: this.trace,
      };
    }

    private resolveMatchedRouter(model: string, pricingContext?: ModelPricingContext) {
      return resolveMatchedRouter(this.deps, model, pricingContext);
    }

    private normalizeRouterOptions(router: RouterInstance) {
      return normalizeRouterOptions(this.deps, router);
    }

    constructor(options: LobeClientOptions & Record<string, any> = {}) {
      const startedAt = Date.now();
      this._options = {
        ...options,
        apiKey: options.apiKey?.trim() || DEFAULT_API_KEY,
        baseURL: options.baseURL?.trim(),
      };

      // Save configuration without creating runtimes
      this._routers = routers;
      this._params = params;
      this._id = options.id ?? id;
      this.trace = createRouterTracer(this._id);

      this.trace(
        'constructor done providerId=%s durationMs=%d hasApiKey=%s hasBaseURL=%s',
        this._id,
        getDurationMs(startedAt),
        !!this._options.apiKey,
        !!this._options.baseURL,
      );
    }

    /**
     * Keep routed chat fallback open until the response body reaches a terminal
     * outcome. Bytes and callbacks remain private until the first visible model
     * output, preventing transparent replay after a partial answer or tool call.
     */
    private async runChatWithStreamFallback(
      payload: ChatStreamPayload,
      options: ChatMethodOptions | undefined,
      routeContext: RouteAttemptContext,
    ): Promise<Response> {
      const { matchedRouter, routerOptions } = await selectRouteOptions(
        this.deps,
        payload.model,
        routeContext,
      );
      const routeTasks = params.scheduleRouteRequestSettled
        ? await createRouteRequestTasks(params.scheduleRouteRequestSettled)
        : undefined;
      const run = createRouteRun({
        deps: this.deps,
        matchedRouter,
        model: payload.model,
        providerId: id,
        reportRouteRequestManaged: true,
        routeContext,
        routerOptions,
        routeTasks,
        signal: options?.signal,
      });

      const holdReasoning = await resolveHoldReasoning(params.isImageOutputModel, payload.model);

      const startAttempt = async (optionIndex: number): Promise<ChatStreamFallbackAttempt> => {
        const prepared = await run.prepareAttempt(optionIndex);
        const { attempt, runtime } = prepared;

        try {
          const response = await observeChatAttempt(
            (attemptOptions) => runtime.chat!(payload, attemptOptions),
            options,
            attempt,
            payload.stream !== false,
            (result) => {
              const task = params.onRouteAttemptFinished!(result);
              if (routeTasks) routeTasks.track(Promise.resolve(task));
              else return task;
            },
            { deferCallbacks: true, holdReasoning },
          );
          const durationMs = Date.now() - attempt.startedAt;
          run.reportAttempt(attempt, { completionPending: true, durationMs, success: true });
          run.attachSuccessMetadata(prepared, { completionPending: true, durationMs });

          const observation = getChatAttemptObservation(response);
          if (!observation) throw new Error('Missing chat attempt observation');

          return {
            index: optionIndex,
            observation,
            onCompleted: () =>
              run.notifyRouteSuccess(prepared, {
                routeRequestManaged: Boolean(routeTasks),
                trackDeferredWork: routeTasks?.track,
              }),
            reader: response.body?.getReader(),
            response,
          };
        } catch (error) {
          // Defer cancellation health handling to the terminal outcome, which intentionally ignores it.
          run.reportFailure(prepared, error, {
            completionPending: options?.signal?.aborted ?? false,
          });

          if (
            optionIndex + 1 < routerOptions.length &&
            (await run.shouldContinueAfterError(error, optionIndex))
          ) {
            return startAttempt(optionIndex + 1);
          }
          throw error;
        }
      };

      try {
        return await createChatStreamFallbackResponse({
          onSettled: routeTasks?.settle,
          shouldFallback: createChatAttemptFallbackCheck(params.shouldFallbackChatAttempt),
          startAttempt,
          totalAttempts: routerOptions.length,
        });
      } catch (error) {
        routeTasks?.settle();
        throw error;
      }
    }

    /** Try channels in order; an attempt commits as soon as its method returns. */
    private async runWithFallback<T>(
      model: string,
      requestHandler: (runtime: LobeRuntimeAI, attempt: RouteAttemptStart) => Promise<T>,
      routeContext: RouteAttemptContext,
      signal?: AbortSignal,
    ): Promise<T> {
      const totalStartedAt = Date.now();
      const { metadata } = routeContext;
      const { matchedRouter, routerOptions } = await selectRouteOptions(
        this.deps,
        model,
        routeContext,
      );
      const totalOptions = routerOptions.length;
      const run = createRouteRun({
        deps: this.deps,
        matchedRouter,
        model,
        providerId: id,
        routeContext,
        routerOptions,
        signal,
      });

      this.trace(
        'runWithFallback start model=%s routerId=%s apiType=%s options=%d traceId=%s',
        model,
        matchedRouter.id,
        matchedRouter.apiType,
        totalOptions,
        metadata?.traceId,
      );

      log(
        'resolve router for model=%s apiType=%s options=%d',
        model,
        matchedRouter.apiType,
        totalOptions,
      );

      let lastError: unknown;

      for (let index = 0; index < totalOptions; index += 1) {
        const attempt = index + 1;
        const startTime = Date.now();
        const prepared = await run.prepareAttempt(index);
        const { apiType: resolvedApiType, channelId, remark, runtime } = prepared;

        try {
          this.trace(
            'attempt request start model=%s attempt=%d/%d routerId=%s channelId=%s apiType=%s traceId=%s',
            model,
            attempt,
            totalOptions,
            matchedRouter.id,
            channelId,
            resolvedApiType,
            metadata?.traceId,
          );
          const result = await requestHandler(runtime, prepared.attempt);
          this.trace(
            'attempt request success model=%s attempt=%d/%d routerId=%s channelId=%s apiType=%s durationMs=%d totalMs=%d traceId=%s',
            model,
            attempt,
            totalOptions,
            matchedRouter.id,
            channelId,
            resolvedApiType,
            getDurationMs(startTime),
            getDurationMs(totalStartedAt),
            metadata?.traceId,
          );

          if (totalOptions > 1 && attempt > 1) {
            log(
              'fallback success for model=%s attempt=%d/%d apiType=%s channelId=%s remark=%s',
              model,
              attempt,
              totalOptions,
              resolvedApiType,
              channelId ?? '',
              remark ?? '',
            );
          } else {
            log(
              'request success without fallback for model=%s apiType=%s channelId=%s remark=%s',
              model,
              resolvedApiType,
              channelId ?? '',
              remark ?? '',
            );
          }

          await run.notifyRouteSuccess(prepared);
          run.reportAttempt(prepared.attempt, {
            durationMs: Date.now() - prepared.attempt.startedAt,
            success: true,
          });
          run.attachSuccessMetadata(prepared, {
            durationMs: Date.now() - prepared.attempt.startedAt,
          });

          return result;
        } catch (error) {
          lastError = error;
          this.trace(
            'attempt request error model=%s attempt=%d/%d routerId=%s channelId=%s apiType=%s durationMs=%d totalMs=%d traceId=%s',
            model,
            attempt,
            totalOptions,
            matchedRouter.id,
            channelId,
            resolvedApiType,
            getDurationMs(startTime),
            getDurationMs(totalStartedAt),
            metadata?.traceId,
          );

          run.reportFailure(prepared, error);

          if (!(await run.shouldContinueAfterError(error, index))) throw error;

          if (attempt < totalOptions) {
            log(
              'attempt %d/%d failed (model=%s apiType=%s channelId=%s remark=%s), trying next',
              attempt,
              totalOptions,
              model,
              resolvedApiType,
              channelId ?? '',
              remark ?? '',
            );
          } else {
            log(
              'attempt %d/%d failed (model=%s apiType=%s channelId=%s remark=%s), no more fallbacks',
              attempt,
              totalOptions,
              model,
              resolvedApiType,
              channelId ?? '',
              remark ?? '',
            );
          }
          console.error(error);
        }
      }

      this.trace(
        'runWithFallback failed model=%s routerId=%s options=%d totalMs=%d traceId=%s',
        model,
        matchedRouter.id,
        totalOptions,
        getDurationMs(totalStartedAt),
        metadata?.traceId,
      );

      throw lastError ?? new Error('empty provider options');
    }

    async models() {
      const resolvedRouters = await resolveRouters(this.deps);
      const matchedRouter = this._options.baseURL
        ? (resolvedRouters.find((router) => router.baseURLPattern?.test(this._options.baseURL!)) ??
          resolvedRouters.at(-1)!)
        : resolvedRouters.at(-1)!;
      const routerOptions = normalizeRouterOptions(this.deps, matchedRouter);
      const { runtime } = await createRuntimeFromOption(this.deps, matchedRouter, routerOptions[0]);

      if (
        modelsOption &&
        typeof modelsOption === 'function' && // Use the same baseURL-matched runtime as chat routing for provider model discovery.
        'client' in runtime
      ) {
        const modelList = await modelsOption({
          client: (runtime as any).client,
          options: this._options,
        });
        return await postProcessModelList(modelList);
      }

      return runtime.models?.();
    }

    /**
     * Try router options in order for chat requests.
     * When options is an array, fall back to the next item on failure.
     */
    async chat(payload: ChatStreamPayload, options?: ChatMethodOptions) {
      try {
        const containsRawAudio = hasRawAudioInput(payload);

        if (params.onRouteAttemptFinished && params.shouldFallbackChatAttempt) {
          return await this.runChatWithStreamFallback(payload, options, {
            allowedApiTypes: containsRawAudio ? RAW_AUDIO_API_TYPES : undefined,
            metadata: options?.metadata,
            method: 'chat',
            pricingContext: options?.pricingContext,
            toolsCount: payload.tools?.length ?? 0,
            user: options?.user,
          });
        }

        return await this.runWithFallback(
          payload.model,
          (runtime, attempt) =>
            params.onRouteAttemptFinished
              ? observeChatAttempt(
                  (attemptOptions) => runtime.chat!(payload, attemptOptions),
                  options,
                  attempt,
                  payload.stream !== false,
                  params.onRouteAttemptFinished,
                )
              : runtime.chat!(payload, options),
          {
            allowedApiTypes: containsRawAudio ? RAW_AUDIO_API_TYPES : undefined,
            metadata: options?.metadata,
            method: 'chat',
            pricingContext: options?.pricingContext,
            toolsCount: payload.tools?.length ?? 0,
            user: options?.user,
          },
          options?.signal,
        );
      } catch (e) {
        if (params.chatCompletion?.handleError) {
          const error = params.chatCompletion.handleError(e, this._options);

          if (error) {
            throw error;
          }
        }

        throw e;
      }
    }

    async createImage(payload: CreateImagePayload, options?: CreateImageMethodOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runtime.createImage!(payload, options),
        {
          metadata: options?.metadata,
          method: 'createImage',
          pricingContext: options?.pricingContext,
        },
      );
    }

    async createVideo(payload: CreateVideoPayload, options?: CreateVideoMethodOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime) => createVideoWithCompletionMode(runtime, payload, options),
        {
          metadata: options?.metadata,
          method: 'createVideo',
          pinnedRoute: options?.route,
          pricingContext: options?.pricingContext,
        },
      );
    }

    async handlePollVideoStatus(inferenceId: string, model?: string, route?: VideoPollingRoute) {
      const pinned = await resolvePinnedRoute(this.deps, model, route);
      let matchedRouter = pinned?.router;

      if (!matchedRouter && model) {
        matchedRouter = await resolveMatchedRouter(this.deps, model);
      }

      if (!matchedRouter) {
        const resolvedRouters = await resolveRouters(this.deps, { model });
        const { baseURL } = this._options;
        matchedRouter =
          (baseURL
            ? resolvedRouters.find((router) => router.baseURLPattern?.test(baseURL))
            : undefined) ?? resolvedRouters.at(-1)!;
      }

      const selectedOption = pinned?.option ?? normalizeRouterOptions(this.deps, matchedRouter)[0];
      if (!selectedOption) {
        throw new Error('The video generation channel is no longer available');
      }

      const { id: apiType, runtime } = await createRuntimeFromOption(
        this.deps,
        matchedRouter,
        selectedOption,
      );

      if (route?.apiType && apiType !== route.apiType) {
        throw new Error('The video generation provider route has changed');
      }

      if (!runtime.handlePollVideoStatus) {
        throw new Error('Video polling is not supported by the matched runtime');
      }

      return runtime.handlePollVideoStatus(inferenceId);
    }

    async handleCreateVideoWebhook(payload: HandleCreateVideoWebhookPayload) {
      const model = payload.model ?? (payload.body as { model?: string } | undefined)?.model;
      const resolvedRouters = await resolveRouters(this.deps, { model });
      const routerOptions = normalizeRouterOptions(this.deps, resolvedRouters[0]);
      const { runtime } = await createRuntimeFromOption(
        this.deps,
        resolvedRouters[0],
        routerOptions[0],
      );
      return runtime.handleCreateVideoWebhook!(payload);
    }

    async generateObject(payload: GenerateObjectPayload, options?: GenerateObjectOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime, attempt) => runtime.generateObject!(payload, withAttemptUsage(options, attempt)),
        {
          metadata: options?.metadata,
          method: 'generateObject',
          pricingContext: options?.pricingContext,
          toolsCount: payload.tools?.length ?? 0,
          user: options?.user,
        },
        options?.signal,
      );
    }

    async embeddings(payload: EmbeddingsPayload, options?: EmbeddingsOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime, attempt) => runtime.embeddings!(payload, withAttemptUsage(options, attempt)),
        {
          metadata: options?.metadata,
          method: 'embeddings',
          pricingContext: options?.pricingContext,
          user: options?.user,
        },
        options?.signal,
      );
    }

    async textToSpeech(payload: TextToSpeechPayload, options?: TextToSpeechOptions) {
      return this.runWithFallback(
        payload.model,
        (runtime, attempt) => runtime.textToSpeech!(payload, withAttemptUsage(options, attempt)),
        {
          metadata: options?.metadata,
          method: 'textToSpeech',
          pricingContext: options?.pricingContext,
          user: options?.user,
        },
        options?.signal,
      );
    }

    async transcribe(payload: ASRPayload, options?: ASROptions) {
      return this.runWithFallback(
        payload.model,
        (runtime, attempt) => runtime.transcribe!(payload, withAttemptUsage(options, attempt)),
        { metadata: options?.metadata, method: 'transcribe', user: options?.user },
        options?.signal,
      );
    }

    async decide<Q extends DecisionQuestions>(
      payload: DecisionPayload<Q>,
      options?: DecisionOptions,
    ) {
      return this.runWithFallback(
        payload.model,
        (runtime) => runDecision(runtime, payload, options, this._id),
        {
          metadata: options?.metadata,
          method: 'decide',
          pricingContext: options?.pricingContext,
          user: options?.user,
        },
        options?.signal,
      );
    }
  };
};

export type UniformRuntime = InstanceType<ReturnType<typeof createRouterRuntime>>;

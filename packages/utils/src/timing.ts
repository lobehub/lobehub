import debug from 'debug';

export interface TimingContext {
  requestId: string;
  startedAt: number;
}

export interface TimingMetadata {
  [key: string]: unknown;
}

export interface TimingParams {
  timingRequestId?: string;
  timingStartedAt?: number;
}

export interface TimingSink {
  log: (event: string, metadata?: TimingMetadata) => void;
}

export type TimingLogger = (formatter: string, ...args: unknown[]) => void;

export const createDebugTimingLogger = (namespace: string): TimingLogger => debug(namespace);

export const getDurationMs = (startedAt: number) => Date.now() - startedAt;

export const createTimingRequestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

export const getTimingErrorMetadata = (error: unknown): TimingMetadata => {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorName: error.name,
    };
  }

  if (isRecord(error)) {
    return {
      errorType: typeof error.errorType === 'string' ? error.errorType : undefined,
      status: typeof error.status === 'number' ? error.status : undefined,
    };
  }

  return { errorMessage: String(error) };
};

export const toTimingContext = (params?: TimingParams): TimingContext | undefined =>
  params?.timingRequestId
    ? { requestId: params.timingRequestId, startedAt: params.timingStartedAt ?? Date.now() }
    : undefined;

export const logTiming = (
  logger: TimingLogger,
  context: TimingContext | undefined,
  event: string,
  metadata?: TimingMetadata,
) => {
  if (!context) return;

  const totalMs = getDurationMs(context.startedAt);
  if (metadata) {
    logger('[%s] %s totalMs=%d %O', context.requestId, event, totalMs, metadata);
    return;
  }

  logger('[%s] %s totalMs=%d', context.requestId, event, totalMs);
};

export const logTimingSink = (
  timing: TimingSink | undefined,
  event: string,
  metadata?: TimingMetadata,
) => {
  timing?.log(event, metadata);
};

export const runTimedStage = async <T>(
  logger: TimingLogger,
  context: TimingContext | undefined,
  stage: string,
  task: () => T | Promise<T>,
  metadata?: TimingMetadata,
): Promise<Awaited<T>> => {
  if (!context) return await task();

  const startedAt = Date.now();
  logTiming(logger, context, `${stage}:start`, metadata);

  try {
    const result = await task();
    logTiming(logger, context, `${stage}:done`, {
      ...metadata,
      stageMs: getDurationMs(startedAt),
    });

    return result;
  } catch (error) {
    logTiming(logger, context, `${stage}:error`, {
      ...metadata,
      ...getTimingErrorMetadata(error),
      stageMs: getDurationMs(startedAt),
    });

    throw error;
  }
};

export const runTimedSinkStage = async <T>(
  timing: TimingSink | undefined,
  stage: string,
  task: () => T | Promise<T>,
  metadata?: TimingMetadata,
): Promise<Awaited<T>> => {
  if (!timing) return await task();

  const startedAt = Date.now();
  logTimingSink(timing, `${stage}:start`, metadata);

  try {
    const result = await task();
    logTimingSink(timing, `${stage}:done`, {
      ...metadata,
      stageMs: getDurationMs(startedAt),
    });

    return result;
  } catch (error) {
    logTimingSink(timing, `${stage}:error`, {
      ...metadata,
      ...getTimingErrorMetadata(error),
      stageMs: getDurationMs(startedAt),
    });

    throw error;
  }
};

export const createPrefixedTimingContext = (
  logger: TimingLogger,
  context: TimingContext | undefined,
  prefix: string,
): TimingSink | undefined =>
  context
    ? {
        log: (event: string, metadata?: TimingMetadata) => {
          logTiming(logger, context, `${prefix}.${event}`, metadata);
        },
      }
    : undefined;

export const createTimingHelpers = (namespace: string) => {
  const logger = createDebugTimingLogger(namespace);

  return {
    createPrefixedTimingContext: (context: TimingContext | undefined, prefix: string) =>
      createPrefixedTimingContext(logger, context, prefix),
    logger,
    logTiming: (context: TimingContext | undefined, event: string, metadata?: TimingMetadata) =>
      logTiming(logger, context, event, metadata),
    runTimedStage: <T>(
      context: TimingContext | undefined,
      stage: string,
      task: () => T | Promise<T>,
      metadata?: TimingMetadata,
    ) => runTimedStage(logger, context, stage, task, metadata),
    toTimingContext,
  };
};

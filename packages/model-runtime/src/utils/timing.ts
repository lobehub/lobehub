import debug from 'debug';

import { isRecord, pickString } from './object';

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

export const formatElapsedClockTime = (ms: number) => {
  const normalizedMs = Math.max(0, ms);
  const totalSeconds = Math.floor(normalizedMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}:${mm}:${ss}`;
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

const DURATION_UNITS = [
  { ms: 86_400_000, suffix: 'd' },
  { ms: 3_600_000, suffix: 'h' },
  { ms: 60_000, suffix: 'm' },
  { ms: 1000, suffix: 's' },
] as const;

export interface FormatDurationOptions {
  /**
   * Smallest unit to print. By default seconds are shown below one hour and
   * dropped above it, where they only add noise.
   */
  minUnit?: 'm' | 's';
  /** Zero-pad every unit after the first (`1h 04m`), keeping live timers from jittering. */
  pad?: boolean;
  /** Drop zero-valued trailing units (`1h` instead of `1h 0m`). */
  trimZero?: boolean;
}

/**
 * Compact unit duration: `42s` · `3m 7s` · `1h 23m` · `1d 21h 23m`. Hours roll over
 * into days, so a long-running span never reads as `221h 29m`. The input is floored
 * to the smallest printed unit; round it first when the caller wants rounding.
 */
export const formatDuration = (ms: number, options: FormatDurationOptions = {}): string => {
  const { minUnit, pad, trimZero } = options;
  const total = Math.max(0, ms);
  const lastSuffix = minUnit ?? (total < 3_600_000 ? 's' : 'm');
  const lastIndex = DURATION_UNITS.findIndex((unit) => unit.suffix === lastSuffix);
  const largestIndex = DURATION_UNITS.findIndex((unit) => total >= unit.ms);
  const firstIndex = largestIndex === -1 ? lastIndex : Math.min(largestIndex, lastIndex);

  let remaining = total;
  const parts = DURATION_UNITS.slice(firstIndex, lastIndex + 1).map((unit, index) => {
    const value = Math.floor(remaining / unit.ms);
    remaining -= value * unit.ms;
    return {
      suffix: unit.suffix,
      text: pad && index > 0 ? String(value).padStart(2, '0') : String(value),
      value,
    };
  });

  while (trimZero && parts.length > 1 && parts.at(-1)!.value === 0) parts.pop();

  return parts.map((part) => `${part.text}${part.suffix}`).join(' ');
};

export const createTimingRequestId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const getTimingErrorMetadata = (error: unknown): TimingMetadata => {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorName: error.name,
    };
  }

  if (isRecord(error)) {
    return {
      errorType: pickString(error.errorType),
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

export const markTimingStageDone = (
  logger: TimingLogger,
  context: TimingContext | undefined,
  stage: string,
  metadata?: TimingMetadata,
) => {
  if (!context) return;

  logTiming(logger, context, `${stage}:done`, {
    ...metadata,
    stageMs: 0,
  });
};

export const markTimingSinkStageDone = (
  timing: TimingSink | undefined,
  stage: string,
  metadata?: TimingMetadata,
) => {
  logTimingSink(timing, `${stage}:done`, {
    ...metadata,
    stageMs: 0,
  });
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
    markStageDone: (context: TimingContext | undefined, stage: string, metadata?: TimingMetadata) =>
      markTimingStageDone(logger, context, stage, metadata),
    runTimedStage: <T>(
      context: TimingContext | undefined,
      stage: string,
      task: () => T | Promise<T>,
      metadata?: TimingMetadata,
    ) => runTimedStage(logger, context, stage, task, metadata),
    toTimingContext,
  };
};

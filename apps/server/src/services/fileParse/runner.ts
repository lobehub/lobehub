import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { MAX_UPLOAD_FILE_COUNT } from '@lobechat/const';
import { FileParseBudgetError, UnsupportedFileTypeError } from '@lobechat/file-loaders';

import { FileParseError, isFileParseError } from './errors';
import type { FileParseJob, FileParseWorkerMessage, SerializedWorkerError } from './protocol';
import {
  BUDGET_ERROR_NAME,
  LOAD_FAILED_ERROR_NAME,
  OUTPUT_TOO_LARGE_ERROR_NAME,
  UNSUPPORTED_FILE_TYPE_ERROR_NAME,
} from './protocol';

/** Limits of one runner. Tests construct their own; production uses these. */
export interface FileParseRunnerOptions {
  /** Tasks running at the same time; each one is a thread that may hold ~1GB. */
  maxConcurrent: number;
  /** Heap limit of one worker. The web pod has 3GiB, shared with the request threads. */
  maxOldGenerationSizeMb: number;
  /** Waiting tasks beyond this are refused at once. */
  maxQueue: number;
  /**
   * Input bytes the waiting tasks may hold in memory together. Datasets and chunk jobs carry their
   * content and count; a file job waits as a path and holds no bytes. Beyond this a task is
   * refused at once.
   */
  maxQueuedBytes: number;
  /** Wall time of one parse; the worker is terminated when it runs out. */
  parseTimeoutMs: number;
  /**
   * How long a task may wait for a free slot. Defaults to the longest the tasks ahead can hold it:
   * `parseTimeoutMs` for each of the `maxQueue + 1` tasks, so a full normal upload never times out
   * only because of its own earlier files.
   */
  queueTimeoutMs: number;
  /** Absolute path of the built worker file; read on every task so a missing file fails closed. */
  workerPath: () => string;
}

export const DEFAULT_FILE_PARSE_LIMITS = {
  maxConcurrent: 1,
  maxOldGenerationSizeMb: 768,
  // One upload may carry MAX_UPLOAD_FILE_COUNT files and the attachments are parsed together:
  // with one slot running, the rest of a normal upload must fit in the queue.
  maxQueue: MAX_UPLOAD_FILE_COUNT - 1,
  maxQueuedBytes: 128 * 1024 * 1024,
  parseTimeoutMs: 60_000,
  // The queue holds the rest of one upload (maxQueue), the running task included that is
  // MAX_UPLOAD_FILE_COUNT tasks in series, each bounded by parseTimeoutMs: 10 x 60s = 10 min.
  // Waiting longer than that is a saturated pod, not a slow queue.
  queueTimeoutMs: 60_000 * MAX_UPLOAD_FILE_COUNT,
} as const;

/** Environment a worker is given: parsing needs none of the process credentials. */
const WORKER_ENV_KEYS = ['DEBUG', 'LANG', 'NODE_ENV', 'TEMP', 'TMP', 'TMPDIR', 'TZ'] as const;

/**
 * A V8 heap flag on the parent process (`--max-old-space-size` and friends, from the command line
 * or `NODE_OPTIONS`) overrides the `resourceLimits` of every worker thread (Node docs, `Worker`
 * options), and neither the worker `env` nor `execArgv` can undo it. So the budget is verified,
 * not assumed: a probe thread, never a parser, reports the heap limit it really got.
 */
const HEAP_PROBE_YOUNG_MB = 48;
const HEAP_PROBE_SOURCE = `
const { parentPort } = require('node:worker_threads');
parentPort.postMessage(require('node:v8').getHeapStatistics().heap_size_limit);
`;

/**
 * Heap limit (bytes) a thread gets with the given old generation size, as the parent flags leave it.
 * Settles only after the probe thread has exited; a probe that errors or never answers within
 * `timeoutMs` is terminated and rejected, so a stuck probe cannot hold a task forever.
 */
const probeHeapLimitBytes = (maxOldGenerationSizeMb: number, timeoutMs: number) =>
  new Promise<number>((resolve, reject) => {
    let limit: number | undefined;
    let failure: Error | undefined;
    const probe = new Worker(HEAP_PROBE_SOURCE, {
      env: {},
      eval: true,
      execArgv: [],
      resourceLimits: {
        // Explicit, so the expected limit is exactly old + young instead of a V8 default.
        maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: HEAP_PROBE_YOUNG_MB,
      },
    });
    const timer = setTimeout(() => {
      failure ??= new Error(`heap probe did not answer within ${timeoutMs}ms`);
      void probe.terminate();
    }, timeoutMs);
    probe.on('message', (value: number) => (limit = value));
    probe.on('error', (error) => (failure ??= error));
    probe.on('exit', () => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (limit === undefined) reject(new Error('heap probe exited without a result'));
      else resolve(limit);
    });
  });

const buildWorkerEnv = () => {
  const env: Record<string, string> = {};
  for (const key of WORKER_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
};

export interface FileParseRunOptions {
  /** Called when a slot is taken and the worker starts (the task has stopped waiting). */
  onStart?: () => void;
}

export interface FileParseRunner {
  run: <T>(job: FileParseJob, options?: FileParseRunOptions) => Promise<T>;
  stats: () => { active: number; queued: number };
}

interface Task {
  job: FileParseJob;
  /** Input bytes this task holds while it waits; 0 for a file job, which waits as a path. */
  memoryBytes: number;
  onStart?: () => void;
  reject: (error: Error) => void;
  resolve: (value: never) => void;
}

const heldBytes = (job: FileParseJob) => {
  // Datasets and chunk jobs carry their content; a file job waits as a path and holds nothing.
  const content = 'content' in job ? job.content : undefined;
  if (content === undefined) return 0;
  return typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
};

const toTypedError = (error: SerializedWorkerError, job: FileParseJob): Error => {
  // Semantics callers branch on survive the thread boundary.
  if (error.name === UNSUPPORTED_FILE_TYPE_ERROR_NAME && job.kind === 'file') {
    return new UnsupportedFileTypeError(error.fileType ?? '', path.basename(job.filePath));
  }
  // A structural refusal keeps its reason and numbers: callers tell the user the file is too large.
  if (error.name === BUDGET_ERROR_NAME && error.budget) {
    return new FileParseBudgetError(error.budget.reason, error.budget.limit, error.budget.actual);
  }
  if (error.name === LOAD_FAILED_ERROR_NAME)
    return new FileParseError('LOAD_FAILED', error.message);
  if (error.name === OUTPUT_TOO_LARGE_ERROR_NAME)
    return new FileParseError('OUTPUT_TOO_LARGE', error.message);
  return new FileParseError('PARSE_FAILED', error.message);
};

/**
 * Runs each parse on its own `worker_threads` thread, so a parser that blocks for seconds blocks
 * only that thread and never the request thread or the tenant lease heartbeat.
 *
 * A task settles only after the thread has really exited, so the slot, the temp file and the
 * memory are free by the time the caller continues. There is no main-thread fallback anywhere.
 */
export const createFileParseRunner = (
  limits: Partial<Omit<FileParseRunnerOptions, 'workerPath'>> &
    Pick<FileParseRunnerOptions, 'workerPath'>,
): FileParseRunner => {
  const merged = { ...DEFAULT_FILE_PARSE_LIMITS, ...limits };
  const options: FileParseRunnerOptions = {
    ...merged,
    // Follows a custom parse timeout / queue size unless the caller fixed the wait itself.
    queueTimeoutMs: limits.queueTimeoutMs ?? merged.parseTimeoutMs * (merged.maxQueue + 1),
  };
  const queue: Array<Task & { timer: NodeJS.Timeout }> = [];
  let active = 0;
  /** The process flags never change, so one successful probe holds for the runner's life. */
  let heapProbe: Promise<number> | undefined;

  /**
   * Fails closed when the parent's V8 flags give a worker more heap than `maxOldGenerationSizeMb`
   * allows. A smaller limit is kept: it is inside the budget (a parse may then run out of memory
   * earlier, as a typed `OUT_OF_MEMORY`).
   */
  const assertHeapBudgetHolds = async () => {
    heapProbe ??= probeHeapLimitBytes(
      options.maxOldGenerationSizeMb,
      // The default parse budget, not the caller's: a thread cold start must not depend on a tight one.
      DEFAULT_FILE_PARSE_LIMITS.parseTimeoutMs,
    );
    let actualBytes: number;
    try {
      actualBytes = await heapProbe;
    } catch (error) {
      heapProbe = undefined;
      throw error;
    }
    const allowedBytes = (options.maxOldGenerationSizeMb + HEAP_PROBE_YOUNG_MB) * 1024 * 1024;
    if (actualBytes > allowedBytes) {
      throw new FileParseError(
        'START_FAILED',
        `File parse workers get ${Math.round(actualBytes / 1024 / 1024)}MB of heap instead of the ` +
          `${options.maxOldGenerationSizeMb}MB old generation budget: the Node process was started ` +
          'with a larger V8 heap flag (--max-old-space-size / --max-heap-size, on the command line ' +
          'or in NODE_OPTIONS), which overrides the worker limit. Remove it or lower it to at most ' +
          'the budget.',
      );
    }
  };

  /**
   * Removes a scratch directory. A failure never changes the outcome of the task (the parse result
   * or error stays as it is) but is not silent: one event with the job kind and the filesystem
   * error code, never the path or the file name.
   */
  const removeScratch = async (scratchDir: string, kind: FileParseJob['kind']) => {
    try {
      await rm(scratchDir, { force: true, recursive: true });
    } catch (error) {
      console.warn(
        JSON.stringify({
          code: (error as { code?: unknown } | undefined)?.code,
          event: 'file_parse.cleanup_failed',
          jobKind: kind,
        }),
      );
    }
  };

  /** Gives the slot back after everything the task held is gone, then lets the queue move on. */
  const release = () => {
    active -= 1;
    pump();
  };

  /**
   * Runs a task that already owns a slot (`active` was raised by the caller before this first
   * await, so no other task can slip in while the filesystem is being asked). Everything the
   * request thread does here is async: a stalled temp volume delays this task only.
   */
  const start = async (task: Task) => {
    // The artifact is resolved when the task actually starts: a deploy fixing it takes effect at once.
    let workerPath: string;
    try {
      workerPath = options.workerPath();
      await access(workerPath);
    } catch (error) {
      task.reject(
        new FileParseError(
          'UNAVAILABLE',
          'File parse worker artifact is missing; build it with `bun run build:file-parse-worker`',
          { cause: error },
        ),
      );
      return release();
    }

    // Before any parser is loaded: a worker that would outgrow its budget never starts.
    try {
      await assertHeapBudgetHolds();
    } catch (error) {
      task.reject(
        isFileParseError(error)
          ? error
          : new FileParseError(
              'START_FAILED',
              'Could not verify the file parse worker heap limit',
              {
                cause: error,
              },
            ),
      );
      return release();
    }

    // A chunk job (epub writes a temp file) gets a scratch directory of its own as `TMPDIR`. A
    // thread killed at the deadline cannot run its `finally`, so the runner removes the directory
    // once the thread has exited and before the task settles.
    let scratchDir: string | undefined;
    let worker: Worker;
    try {
      const env = buildWorkerEnv();
      if (task.job.kind === 'chunk') {
        scratchDir = await mkdtemp(path.join(tmpdir(), 'file-parse-'));
        env.TMPDIR = scratchDir;
      }
      task.onStart?.();
      worker = new Worker(workerPath, {
        env,
        // Keep the parent's loaders (tsx, Sentry preloads…) out of the thread.
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: options.maxOldGenerationSizeMb },
        workerData: task.job,
      });
    } catch (error) {
      if (scratchDir) await removeScratch(scratchDir, task.job.kind);
      task.reject(
        new FileParseError('START_FAILED', 'Could not start the file parse worker', {
          cause: error,
        }),
      );
      return release();
    }

    let message: FileParseWorkerMessage | undefined;
    let workerError: (Error & { code?: string }) | undefined;
    let timedOut = false;

    // Only the exit event settles a task. A thread stuck in native code keeps its slot, its temp
    // file and the caller waiting: releasing any of them early would let a second parse start
    // while the first still holds the memory.
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      void worker.terminate();
    }, options.parseTimeoutMs);

    worker.on('message', (value: FileParseWorkerMessage) => {
      message ??= value;
      clearTimeout(timeoutTimer);
      // The result is in; end the thread and wait for the exit event to settle.
      void worker.terminate();
    });
    worker.on('error', (error: Error) => {
      workerError ??= error;
    });
    const settleAfterExit = (code: number) => {
      // Timeout first: a result that arrived after the deadline must not be accepted (and stored).
      if (timedOut) {
        return task.reject(
          new FileParseError('TIMEOUT', `File parsing exceeded ${options.parseTimeoutMs}ms`),
        );
      }
      if (message?.type === 'result') return task.resolve(message.value as never);
      if (message?.type === 'error') return task.reject(toTypedError(message.error, task.job));
      if (workerError?.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        return task.reject(
          new FileParseError(
            'OUT_OF_MEMORY',
            `File parsing exceeded the ${options.maxOldGenerationSizeMb}MB worker memory limit`,
            { cause: workerError },
          ),
        );
      }
      if (workerError) {
        return task.reject(
          new FileParseError('WORKER_FAILED', `File parse worker failed: ${workerError.message}`, {
            cause: workerError,
          }),
        );
      }
      task.reject(
        new FileParseError(
          'WORKER_FAILED',
          `File parse worker exited with code ${code} without a result`,
        ),
      );
    };
    worker.on('exit', (code) => {
      clearTimeout(timeoutTimer);
      void (async () => {
        // The scratch directory is gone, and the slot free, before the caller hears the outcome.
        if (scratchDir) await removeScratch(scratchDir, task.job.kind);
        active -= 1;
        settleAfterExit(code);
        pump();
      })();
    });
  };

  function pump() {
    while (active < options.maxConcurrent && queue.length > 0) {
      const next = queue.shift()!;
      clearTimeout(next.timer);
      active += 1;
      void start(next);
    }
  }

  return {
    run<T>(job: FileParseJob, runOptions: FileParseRunOptions = {}) {
      return new Promise<T>((resolve, reject) => {
        const task: Task = {
          job,
          memoryBytes: heldBytes(job),
          onStart: runOptions.onStart,
          reject,
          resolve: resolve as never,
        };

        if (active < options.maxConcurrent) {
          active += 1;
          return void start(task);
        }

        const queuedBytes = queue.reduce((sum, waiting) => sum + waiting.memoryBytes, 0);
        if (
          queue.length >= options.maxQueue ||
          queuedBytes + task.memoryBytes > options.maxQueuedBytes
        ) {
          return reject(
            new FileParseError(
              'QUEUE_FULL',
              `File parsing is busy: ${queue.length} tasks (${queuedBytes} bytes) already waiting`,
            ),
          );
        }

        const entry = {
          ...task,
          timer: setTimeout(() => {
            queue.splice(queue.indexOf(entry), 1);
            reject(
              new FileParseError(
                'QUEUE_TIMEOUT',
                `File parsing waited ${options.queueTimeoutMs}ms for a free worker`,
              ),
            );
          }, options.queueTimeoutMs),
        };
        queue.push(entry);
      });
    },
    stats: () => ({ active, queued: queue.length }),
  };
};

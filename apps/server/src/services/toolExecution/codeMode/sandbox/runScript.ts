import { Worker } from 'node:worker_threads';

import { CODE_MODE_WORKER_SOURCE } from './workerSource';

/** A failed tool call, as the script sees it: thrown as an `Error` carrying `code`. */
export interface ScriptToolError {
  code: string;
  message: string;
}

export type ScriptToolCallResult =
  { ok: true; value: unknown } | { error: ScriptToolError; ok: false };

export interface RunScriptOptions {
  code: string;
  /** Hard cap on the logged text the script may return. */
  maxLogChars: number;
  /** Tool calls allowed per run; the call past the cap fails inside the script. */
  maxToolCalls: number;
  /** V8 old-generation heap cap of the worker, in MB. */
  memoryLimitMb: number;
  /** Answers one tool call; never rejects (a failure is a `{ ok: false }` result). */
  onToolCall: (name: string, argsJson: string) => Promise<ScriptToolCallResult>;
  signal?: AbortSignal;
  /** Wall-clock budget for the whole script, tool calls included. */
  timeoutMs: number;
  /** `identifier.toolName` names exposed on the script's `tools` namespace. */
  toolNames: string[];
}

export interface RunScriptError {
  code:
    | 'ABORTED'
    | 'MEMORY_LIMIT'
    | 'RESULT_NOT_SERIALIZABLE'
    | 'SANDBOX_CRASHED'
    | 'SANDBOX_INIT_FAILED'
    | 'SCRIPT_ERROR'
    | 'SCRIPT_SYNTAX_ERROR'
    | 'TIMEOUT'
    | (string & {});
  message: string;
  stack?: string;
  tool?: string;
}

export interface RunScriptOutcome {
  error?: RunScriptError;
  logs: string[];
  logsTruncated?: boolean;
  ok: boolean;
  toolCallCount: number;
  /** The script's return value, JSON-decoded; `undefined` when it returned nothing. */
  value?: unknown;
}

interface WorkerDoneOutcome {
  error?: RunScriptError;
  logs?: string[];
  logsTruncated?: boolean;
  ok: boolean;
  value?: string;
}

/**
 * Run a model-written script in a fresh worker thread and wait for it.
 *
 * The worker is single-use: it is terminated once the script settles, times
 * out, exceeds its heap or the caller aborts, so a runaway loop never touches
 * the server's own event loop. Tool calls the script makes are forwarded to
 * `onToolCall` and may run concurrently (`Promise.all` in the script). Calls
 * still in flight when the run ends are not cancelled — their results are
 * discarded.
 */
export const runCodeModeScript = (options: RunScriptOptions): Promise<RunScriptOutcome> =>
  new Promise((resolve) => {
    const { code, maxLogChars, maxToolCalls, memoryLimitMb, onToolCall, signal, timeoutMs } =
      options;

    let toolCallCount = 0;
    let settled = false;

    if (signal?.aborted) {
      resolve({
        error: { code: 'ABORTED', message: 'The script was cancelled before it started.' },
        logs: [],
        ok: false,
        toolCallCount,
      });
      return;
    }

    const worker = new Worker(CODE_MODE_WORKER_SOURCE, {
      env: {},
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: memoryLimitMb,
        maxYoungGenerationSizeMb: Math.max(4, Math.floor(memoryLimitMb / 8)),
        stackSizeMb: 4,
      },
      stderr: true,
      stdout: true,
      workerData: {
        code,
        maxLogChars,
        syncTimeoutMs: timeoutMs,
        toolNames: options.toolNames,
      },
    });
    // The script has no console of its own on the server; drain both streams so
    // a stray write from the worker runtime can't block it.
    worker.stdout.resume();
    worker.stderr.resume();

    const finish = (outcome: Omit<RunScriptOutcome, 'toolCallCount'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      void worker.terminate();
      resolve({ ...outcome, toolCallCount });
    };

    const timer = setTimeout(() => {
      finish({
        error: {
          code: 'TIMEOUT',
          message: `The script did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped. Tool calls it had already started may still have taken effect.`,
        },
        logs: [],
        ok: false,
      });
    }, timeoutMs);

    const onAbort = () =>
      finish({
        error: { code: 'ABORTED', message: 'The script was cancelled.' },
        logs: [],
        ok: false,
      });
    signal?.addEventListener('abort', onAbort, { once: true });

    const answer = (id: number, result: ScriptToolCallResult) => {
      if (settled) return;
      if (result.ok) {
        let payload = '';
        try {
          payload = result.value === undefined ? '' : (JSON.stringify(result.value) ?? '');
        } catch {
          payload = JSON.stringify(String(result.value));
        }
        worker.postMessage({ id, ok: true, payload, type: 'result' });
        return;
      }
      worker.postMessage({
        id,
        ok: false,
        payload: JSON.stringify({ code: result.error.code, message: result.error.message }),
        type: 'result',
      });
    };

    worker.on('message', (message: any) => {
      if (settled || !message || typeof message !== 'object') return;

      if (message.type === 'call' && typeof message.id === 'number') {
        const name = typeof message.name === 'string' ? message.name : '';
        const argsJson = typeof message.args === 'string' ? message.args : '{}';
        toolCallCount += 1;
        if (toolCallCount > maxToolCalls) {
          answer(message.id, {
            error: {
              code: 'TOOL_CALL_LIMIT',
              message: `A script may make at most ${maxToolCalls} tool calls; "${name}" was not run. Split the work across several execute calls.`,
            },
            ok: false,
          });
          return;
        }
        onToolCall(name, argsJson).then(
          (result) => answer(message.id, result),
          (error: unknown) =>
            answer(message.id, {
              error: {
                code: 'TOOL_CALL_FAILED',
                message: error instanceof Error ? error.message : String(error),
              },
              ok: false,
            }),
        );
        return;
      }

      if (message.type === 'done') {
        const outcome = message.outcome as WorkerDoneOutcome;
        let value: unknown;
        if (outcome.ok && outcome.value) {
          try {
            value = JSON.parse(outcome.value);
          } catch {
            value = outcome.value;
          }
        }
        finish({
          error: outcome.error,
          logs: outcome.logs ?? [],
          logsTruncated: outcome.logsTruncated,
          ok: outcome.ok,
          value,
        });
      }
    });

    worker.on('error', (error: Error & { code?: string }) => {
      const isOom = error.code === 'ERR_WORKER_OUT_OF_MEMORY';
      finish({
        error: isOom
          ? {
              code: 'MEMORY_LIMIT',
              message: `The script exceeded its ${memoryLimitMb} MB memory limit and was stopped.`,
            }
          : { code: 'SANDBOX_CRASHED', message: error.message },
        logs: [],
        ok: false,
      });
    });

    worker.on('exit', (exitCode) => {
      finish({
        error: {
          code: 'SANDBOX_CRASHED',
          message: `The script sandbox exited unexpectedly (code ${exitCode}).`,
        },
        logs: [],
        ok: false,
      });
    });
  });

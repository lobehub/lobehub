import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

import { DshAdapter } from '../adapters/dsh';
import type { HeterogeneousAgentEvent } from '../types';
import { resolveCliSpawnPlan } from './cliSpawn';

/**
 * Drives a DeepSeek Harness SDK runtime over newline-delimited JSON-RPC on
 * stdio — the `@deepseek-ai/dsh-sdk-protocol` wire (`initialize`,
 * `session/prompt`, `shutdown`; `session.event` / `session.status`
 * notifications).
 *
 * The runtime is the official DeepSeek Harness CLI (`@deepseek-ai/dsh`)
 * launched with its shipped `sdk` profile, the same peer the official
 * `@deepseek-ai/dsh-sdk-client` spawns. LobeHub does not compose or bundle a
 * harness of its own: like Claude Code or Codex, DSH is a user-installed CLI,
 * so no `@deepseek-ai/*` package ships in the desktop core or the CLI bundle.
 *
 * This is the bidirectional counterpart to `spawnAgent`: the harness is a
 * server we send requests to (`initialize`, `session/prompt`, `shutdown`), not
 * a CLI that prints a transcript and exits, so the CLI spawn pipeline does not
 * fit. Its stdout carries protocol frames only.
 */
export interface DshSdkSessionOptions {
  /** Runtime arguments. Defaults to {@link DSH_SDK_PROFILE_ARGS}. */
  args?: string[];
  /** The `dsh` executable (name on PATH or absolute path). Defaults to {@link DSH_COMMAND}. */
  command?: string;
  /**
   * Agent workspace. Sent as the harness session `cwd`, which is what the
   * filesystem tools resolve relative paths against, and used as the child's
   * working directory (the CLI's default workspace root).
   */
  cwd: string;
  env?: Record<string, string>;
  /**
   * Ceiling for the `initialize` handshake. Always applied — callers that set
   * no run timeout still must not hang on a runtime that boots but never
   * answers. Defaults to {@link DSH_INITIALIZE_TIMEOUT_MS}; a smaller
   * {@link timeoutMs} wins.
   */
  initializeTimeoutMs?: number;
  maxTokens?: number;
  model: string;
  provider: string;
  /**
   * Session id to prompt. Unknown ids lazily create the agent, so a caller
   * chooses this rather than discovering it. The adapter binds to it so
   * sibling sessions in the same runtime are filtered out.
   */
  sessionId: string;
  /** Wall-clock ceiling for the whole run. */
  timeoutMs?: number;
}

/** Default bound on the `initialize` handshake (boot + plugin load). */
export const DSH_INITIALIZE_TIMEOUT_MS = 60_000;

/** How long `dispose` waits for a `shutdown` reply before signalling the runtime. */
const SHUTDOWN_TIMEOUT_MS = 2000;

/**
 * How long a SIGTERM'd runtime gets to run its async fiber disposal before it
 * is SIGKILLed. Disposal must not resolve while the old runtime (and the tools
 * it spawned) can still write to the workspace.
 */
const TERMINATE_GRACE_MS = 5000;

/**
 * Settle `promise` or reject after `ms`. The timer is cleared either way so a
 * settled race leaves no handle keeping the event loop alive.
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

/** The official DeepSeek Harness CLI executable (`npm i -g @deepseek-ai/dsh`). */
export const DSH_COMMAND = 'dsh';

/**
 * Select the CLI's shipped `sdk` profile, which serves the SDK JSON-RPC
 * protocol on stdio until `shutdown` or stdin EOF. Transcripts persist under
 * the CLI's own `$DSH_HOME`, never in the agent workspace.
 */
export const DSH_SDK_PROFILE_ARGS: readonly string[] = ['--profile', 'sdk'];

export interface DshSdkSessionHandle {
  /**
   * Terminate the runtime and resolve only once its process has exited
   * (escalating to SIGKILL after a grace period); safe to call more than once.
   */
  dispose: () => Promise<void>;
  /** Stream events for one prompt, ending after the harness reports whole-agent idle. */
  prompt: (text: string) => AsyncGenerator<HeterogeneousAgentEvent>;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (result: any) => void;
}

/** Frames a JSON-RPC line stream and resolves responses against pending requests. */
class JsonRpcStdio {
  private buffer = '';
  /** Set once the transport is gone; later requests fail immediately. */
  private closed?: Error;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  constructor(
    private child: ChildProcessWithoutNullStreams,
    private onNotification: (frame: any) => void,
  ) {
    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk.toString('utf8')));
  }

  request(method: string, params?: unknown): Promise<any> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(this.closed);
        return;
      }
      this.pending.set(id, { reject, resolve });
      this.child.stdin.write(`${JSON.stringify({ id, jsonrpc: '2.0', method, params })}\n`);
    });
  }

  /** Fail every in-flight and future request; the runtime will send no more responses. */
  rejectAll(error: Error): void {
    this.closed ??= error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  private consume(text: string): void {
    this.buffer += text;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      let frame: any;
      try {
        frame = JSON.parse(line);
      } catch {
        // The protocol ignores malformed lines rather than tearing down the
        // connection; a stray write must not kill an in-flight turn.
        continue;
      }

      if (typeof frame.id === 'number' && frame.method === undefined) {
        const waiter = this.pending.get(frame.id);
        this.pending.delete(frame.id);
        if (!waiter) continue;
        if (frame.error) waiter.reject(new Error(frame.error.message ?? 'JSON-RPC error'));
        else waiter.resolve(frame.result);
        continue;
      }

      if (typeof frame.method === 'string') this.onNotification(frame);
    }
  }
}

/**
 * Launch a harness runtime and complete the handshake.
 *
 * @param options - runtime binary, workspace, model route, and session id.
 * @returns a handle whose `prompt` streams one turn's events.
 */
export const spawnDshSdkSession = async (
  options: DshSdkSessionOptions,
): Promise<DshSdkSessionHandle> => {
  const env = { ...process.env, ...options.env } as NodeJS.ProcessEnv;
  // npm installs `dsh` as a `.cmd` shim on Windows, which `spawn` cannot run
  // without a shell; resolve it to its node target like the other CLI agents.
  const runtime = await resolveCliSpawnPlan(
    options.command ?? DSH_COMMAND,
    [...(options.args ?? DSH_SDK_PROFILE_ARGS)],
    env,
  );
  const child = spawn(runtime.command, runtime.args, {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const adapter = new DshAdapter(options.sessionId);
  let queue: HeterogeneousAgentEvent[] = [];
  let wake: (() => void) | undefined;
  let exited: Error | undefined;

  const push = (events: HeterogeneousAgentEvent[]): void => {
    if (events.length === 0) return;
    queue.push(...events);
    wake?.();
  };

  const rpc = new JsonRpcStdio(child, (frame) => push(adapter.adapt(frame)));

  // A missing / non-executable command or an invalid cwd surfaces as an
  // `error` event, not `exit`; without a listener Node rethrows it and takes
  // down the host process. Fail the handshake and any in-flight turn instead.
  child.on('error', (error: NodeJS.ErrnoException) => {
    const hint =
      error.code === 'ENOENT'
        ? ' (install the DeepSeek Harness CLI: npm i -g @deepseek-ai/dsh)'
        : '';
    exited ??= new Error(`harness runtime failed to start: ${error.message}${hint}`);
    rpc.rejectAll(exited);
    wake?.();
  });
  // Writing to a runtime that already died emits EPIPE on stdin; the exit /
  // error handlers own reporting that, so the stream error is only swallowed.
  child.stdin.on('error', () => {});

  child.on('exit', (code, signal) => {
    // Only a clean exit may synthesize a terminal event. Flushing on a crash
    // would close the stream with `agent_runtime_end` and make a dead runtime
    // read as a completed run.
    if (code === 0 && signal === null) {
      push(adapter.flush());
      wake?.();
      return;
    }

    exited = new Error(
      `harness runtime exited (code ${code}, signal ${signal})${stderr ? `: ${stderr.trim()}` : ''}`,
    );
    rpc.rejectAll(exited);
    wake?.();
  });

  const isAlive = () => child.exitCode === null && child.signalCode === null;
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    // A child that never spawned emits `error` and never `exit`.
    child.once('error', () => {
      if (child.pid === undefined) resolve();
    });
  });

  /** SIGTERM, wait out the grace period, then SIGKILL; resolves on exit. */
  let terminating: Promise<void> | undefined;
  const terminate = (): Promise<void> => {
    terminating ??= (async () => {
      if (!isAlive() || child.pid === undefined) return;
      child.kill('SIGTERM');
      const exitedInGrace = await withTimeout(exitPromise, TERMINATE_GRACE_MS, 'grace').then(
        () => true,
        () => false,
      );
      if (exitedInGrace || !isAlive()) return;
      child.kill('SIGKILL');
      // SIGKILL cannot be caught; the bound only guards a zombie reap stall.
      await withTimeout(exitPromise, SHUTDOWN_TIMEOUT_MS, 'kill').catch(() => {});
    })();
    return terminating;
  };

  const initializeTimeoutMs = Math.min(
    options.initializeTimeoutMs ?? DSH_INITIALIZE_TIMEOUT_MS,
    options.timeoutMs ?? Number.POSITIVE_INFINITY,
  );

  const initialize = rpc.request('initialize', {
    cwd: options.cwd,
    model: options.model,
    provider: options.provider,
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
  });
  try {
    await withTimeout(
      initialize,
      initializeTimeoutMs,
      `harness runtime did not answer initialize within ${initializeTimeoutMs}ms`,
    );
  } catch (error) {
    // A runtime that never finished the handshake is useless to the caller,
    // and nobody else holds a handle to kill it.
    void terminate();
    throw error;
  }

  const dispose = async (): Promise<void> => {
    if (!isAlive()) return;
    // `shutdown` is best-effort and bounded: a runtime already tearing down
    // never answers, and the kill below is the real settlement.
    await withTimeout(rpc.request('shutdown'), SHUTDOWN_TIMEOUT_MS, 'shutdown timed out').catch(
      () => {},
    );
    await terminate();
  };

  async function* prompt(text: string): AsyncGenerator<HeterogeneousAgentEvent> {
    const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;
    // The handle is reusable: a previous prompt's whole-agent idle must not
    // mark this one as already finished.
    adapter.beginRun();

    void rpc
      .request('session/prompt', {
        contentBlocks: [{ text, type: 'text' }],
        sessionId: options.sessionId,
      })
      .catch((error: Error) => {
        exited ??= error;
        wake?.();
      });

    for (;;) {
      while (queue.length > 0) {
        const batch = queue;
        queue = [];
        for (const event of batch) {
          yield event;
          // The harness reports whole-agent idle only once the turn and every
          // continuation it scheduled are done, so this is the run boundary.
          if (event.type === 'agent_runtime_end') return;
        }
      }
      // A run that failed ends on its `error` event with no `agent_runtime_end`
      // after it; the adapter still marks the idle as the run boundary.
      if (adapter.isRunFinished()) return;

      if (exited) throw exited;
      if (deadline !== undefined && Date.now() > deadline) {
        throw new Error(`harness run exceeded ${options.timeoutMs}ms`);
      }

      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, 250);
      });
      wake = undefined;
    }
  }

  return { dispose, prompt };
};

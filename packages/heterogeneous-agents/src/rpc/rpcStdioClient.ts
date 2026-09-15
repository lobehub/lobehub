import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

import { resolveCliSpawnPlan } from '../spawn/cliSpawn';

/**
 * Protocol-agnostic JSONL RPC transport over a child process's stdio.
 *
 * Owns everything that is the same for every CLI RPC protocol (pi `--mode
 * rpc`, ACP, codex app-server, …): spawning via `resolveCliSpawnPlan`,
 * LF-only framing, request/response correlation by `id`, timeout + deadline
 * handling, stderr routing, and graceful EOF-first shutdown with signal
 * escalation. The wire schema stays in a thin protocol layer on top (e.g.
 * `PiRpcClient`) which supplies the `isResponse` discriminator and interprets
 * response payloads.
 *
 * Framing note: records split on `\n` only (a trailing `\r` is stripped).
 * Node's `readline` is NOT protocol-compliant for JSONL RPC streams because
 * it also splits on U+2028/U+2029, which are valid inside JSON strings.
 */

/** Error thrown when the child dies, a request times out, or the client closes. */
export class RpcStdioConnectionError extends Error {
  constructor(
    message: string,
    readonly options?: { phase?: 'spawn' | 'run'; stderr?: string },
  ) {
    super(message);
    this.name = 'RpcStdioConnectionError';
  }
}

interface PendingRequest {
  label: string;
  reject: (error: Error) => void;
  resolve: (message: Record<string, unknown>) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export interface RpcStdioClientOptions {
  /** CLI args (protocol-specific flags included). */
  args: string[];
  /** How long to wait for a clean exit after `stdin.end()` before escalating. */
  closeGraceMs?: number;
  /** Absolute (or resolved) path to the executable. */
  commandPath: string;
  cwd: string;
  /** False keeps the child in a device wrapper's process group. Defaults to true on Unix. */
  detached?: boolean;
  env: NodeJS.ProcessEnv;
  /**
   * Discriminates a response to a client request from a notification/event.
   * A message passing this predicate whose `id` matches a pending request
   * resolves it. Default: JSON-RPC-2.0-shaped messages (has `id`, no
   * `method`); pi passes `(m) => m?.type === 'response'`.
   */
  isResponse?: (message: Record<string, unknown>) => boolean;
  /** Fatal transport errors, including exits after a command was accepted. */
  onError?: (error: Error) => void;
  /**
   * Invoked for every parsed message that is NOT the response to a pending
   * request — i.e. notifications, events, and server-initiated requests.
   */
  onMessage: (message: Record<string, unknown>) => void | Promise<void>;
  onStderr: (data: string) => void | Promise<void>;
  /** Default per-request timeout. `false` disables it. */
  requestTimeoutMs?: number | false;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_GRACE_MS = 3_000;
const ESCALATE_KILL_MS = 2_000;

const defaultIsResponse = (message: Record<string, unknown>): boolean =>
  'id' in message && !('method' in message);

export class RpcStdioClient {
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private child?: ChildProcess;
  private closePromise?: Promise<void>;
  private closed = false;
  private exited = false;
  private fatalError?: Error;
  private messageQueue: Promise<void> = Promise.resolve();
  private nextRequestId = 0;
  private readonly stderrChunks: string[] = [];
  private readonly stderrDecoder = new StringDecoder('utf8');
  private readonly stdoutDecoder = new StringDecoder('utf8');
  private stdoutBuffer = '';

  constructor(private readonly options: RpcStdioClientOptions) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get isClosed(): boolean {
    return this.closed || this.exited || !!this.fatalError;
  }

  get stderrText(): string {
    return this.stderrChunks.join('');
  }

  /**
   * Spawn the child (no protocol handshake — the protocol layer owns that).
   * Rejects with `RpcStdioConnectionError` when the spawn itself fails.
   */
  async start(): Promise<void> {
    if (this.child || this.closed) return;

    const spawnPlan = await resolveCliSpawnPlan(this.options.commandPath, this.options.args);
    if (this.closed) return;
    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: this.options.cwd,
      detached: process.platform !== 'win32' && (this.options.detached ?? true),
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdin?.once('error', (error) => {
      if (!this.closed) this.fail(this.toError(error));
    });
    child.stdout?.on('data', (chunk: Buffer) => this.consumeStdout(chunk));
    child.stdout?.once('end', () => this.consumeRemainingStdout());
    child.stdout?.once('error', (error) => this.fail(this.toError(error)));
    child.stderr?.on('data', (chunk: Buffer) => {
      this.consumeStderr(this.stderrDecoder.write(chunk));
    });
    child.stderr?.once('end', () => this.consumeStderr(this.stderrDecoder.end()));
    child.once('error', (error) => {
      this.fail(
        new RpcStdioConnectionError(`Failed to start RPC process: ${error.message}`, {
          phase: 'spawn',
        }),
      );
    });
    child.once('close', (code, signal) => {
      this.exited = true;
      if (this.closed) return;
      const error = new RpcStdioConnectionError(
        `RPC process exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
        { phase: 'run', stderr: this.stderrText },
      );
      // Node may emit process exit before stdout fully drains. `close` waits
      // for stdio, then this queue wait lets a final structured RPC error win
      // over the less useful process-exit fallback.
      this.messageQueue = this.messageQueue.then(() => this.fail(error));
    });
  }

  /**
   * Send a payload and await the matching response. Assigns a numeric `id`
   * when the payload lacks one; the response must pass `isResponse` and echo
   * that `id`. Rejects on timeout, host close, or process death. The payload
   * is delivered to the child verbatim — interpretation is the protocol
   * layer's job.
   */
  request<T = unknown>(
    payload: Record<string, unknown>,
    timeoutMs?: number | false,
    label = String(payload.type ?? payload.method ?? 'request'),
  ): Promise<T> {
    if (this.fatalError) throw this.fatalError;
    if (this.closed) throw new RpcStdioConnectionError('RPC client is closed');
    if (!this.child?.stdin) throw new RpcStdioConnectionError('RPC stdin is unavailable');

    const id = String(++this.nextRequestId);
    const message = { ...payload, id };
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        label,
        reject,
        resolve: (response) => resolve(response as T),
      };
      const timeout = timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      if (timeout !== false) {
        pending.timeout = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new RpcStdioConnectionError(`RPC request timed out: ${label}`, { phase: 'run' }));
        }, timeout);
        pending.timeout.unref?.();
      }
      this.pendingRequests.set(id, pending);
      try {
        this.writeMessage(message);
      } catch (error) {
        if (this.pendingRequests.get(id) === pending) this.pendingRequests.delete(id);
        if (pending.timeout) clearTimeout(pending.timeout);
        reject(this.toError(error));
      }
    });
  }

  /** Fire-and-forget write — no response is awaited. */
  notify(payload: Record<string, unknown>): void {
    if (this.closed || !this.child?.stdin) return;
    this.writeMessage(payload);
  }

  /**
   * Graceful close: send EOF, wait for the child to exit, escalate to SIGTERM
   * then SIGKILL only if it lingers. Pending requests reject with
   * 'closed by host'. Resolves once the child is gone (or was never spawned).
   */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.rejectPendingRequests(new RpcStdioConnectionError('RPC client closed by host'));
    this.closePromise ??= this.shutdown();
    return this.closePromise;
  }

  private consumeStdout(chunk: Buffer): void {
    if (this.closed) return;
    this.stdoutBuffer += this.stdoutDecoder.write(chunk);

    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.enqueueLine(line);
    }
  }

  private consumeStderr(text: string): void {
    if (!text) return;
    this.stderrChunks.push(text);
    void Promise.resolve()
      .then(() => this.options.onStderr(text))
      .catch((error) => this.fail(this.toError(error)));
  }

  private consumeRemainingStdout(): void {
    if (this.closed) {
      this.stdoutBuffer = '';
      return;
    }
    this.stdoutBuffer += this.stdoutDecoder.end();
    if (!this.stdoutBuffer) return;
    const line = this.stdoutBuffer;
    this.stdoutBuffer = '';
    this.enqueueLine(line);
  }

  private enqueueLine(rawLine: string): void {
    if (this.closed) return;
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) return;

    this.messageQueue = this.messageQueue
      .then(() => this.handleLine(line))
      .catch((error) => this.fail(this.toError(error)));
  }

  private async handleLine(line: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      // One non-JSON diagnostic line must not corrupt framing.
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;

    const record = message as Record<string, unknown>;
    if (this.options.isResponse?.(record) ?? defaultIsResponse(record)) {
      const key = record.id;
      if (key === undefined) return;
      const pending = this.pendingRequests.get(String(key));
      if (!pending) return;

      this.pendingRequests.delete(String(key));
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.resolve(record);
      return;
    }

    await this.options.onMessage(record);
  }

  private writeMessage(message: Record<string, unknown>): void {
    if (!this.child?.stdin || this.closed) {
      throw new RpcStdioConnectionError('RPC stdin is unavailable');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async shutdown(): Promise<void> {
    const child = this.child;
    if (!child || this.exited) return;

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const onClose = () => {
        clearTimeout(timer);
        resolve();
      };
      child.once('close', onClose);
      timer = setTimeout(() => {
        this.terminateChild(child, 'SIGTERM');
        if (this.exited) return;
        timer = setTimeout(() => {
          this.terminateChild(child, 'SIGKILL');
          if (this.exited) return;
          timer = setTimeout(() => {
            child.off('close', onClose);
            reject(new RpcStdioConnectionError('RPC process did not exit after SIGKILL'));
          }, ESCALATE_KILL_MS);
        }, ESCALATE_KILL_MS);
      }, this.options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS);
      try {
        child.stdin?.end();
      } catch {
        // A broken stdin still needs the signal escalation above.
      }
    });
  }

  private fail(error: Error): void {
    if (this.closed || this.fatalError) return;
    this.fatalError = error;
    this.rejectPendingRequests(error);
    this.options.onError?.(error);
  }

  /**
   * Reject every in-flight request with `error` WITHOUT closing the process.
   * Used by protocol layers to abort a specific handshake/watchdog wait while
   * keeping the transport usable (or to let the caller decide the shutdown).
   */
  abortPendingRequests(error: Error): void {
    this.rejectPendingRequests(error);
  }

  private rejectPendingRequests(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private terminateChild(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid || this.exited) return;

    if (process.platform === 'win32') {
      const killChild = () => {
        try {
          child.kill(signal);
        } catch {
          // The exit event may still be draining.
        }
      };
      try {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
        });
        killer.once('error', killChild);
        killer.once('exit', (code) => {
          if (code !== 0) killChild();
        });
      } catch {
        killChild();
      }
      return;
    }

    if (this.options.detached !== false) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall back to the child when its own process group is gone.
      }
    }

    // An inherited group belongs to the wrapper, not this transport.
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}

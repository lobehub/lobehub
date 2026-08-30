import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import { resolveCliSpawnPlan } from './cliSpawn';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface AcpRpcErrorData {
  code?: number;
  data?: unknown;
  message?: string;
}

export interface AcpRpcMessage {
  error?: AcpRpcErrorData;
  id?: number | string;
  jsonrpc?: string;
  method?: string;
  params?: unknown;
  requestMethod?: string;
  result?: unknown;
}

interface PendingRpcRequest {
  method: string;
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export interface AcpStdioClientOptions {
  args: string[];
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  onMessage: (message: AcpRpcMessage) => Promise<void> | void;
  onRawMessage: (line: string) => Promise<void> | void;
  onServerRequest?: (message: AcpRpcMessage) => Promise<unknown> | unknown;
  onStderr: (data: string) => Promise<void> | void;
  processLabel?: string;
  requestTimeoutMs?: number;
}

/** A JSON-RPC error that a client intentionally returns to an ACP server request. */
export class AcpServerRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AcpServerRequestError';
  }
}

/** An error returned by the ACP server for a client request. */
export class AcpRpcResponseError extends Error {
  constructor(
    readonly method: string,
    readonly rpcError: AcpRpcErrorData,
  ) {
    const detail =
      typeof rpcError.data === 'string'
        ? rpcError.data
        : rpcError.data === undefined
          ? ''
          : JSON.stringify(rpcError.data);
    super(
      [`ACP request failed (${method}): ${rpcError.message ?? 'Unknown error'}`, detail]
        .filter(Boolean)
        .join(': '),
    );
    this.name = 'AcpRpcResponseError';
  }
}

/**
 * Reusable ACP transport: a persistent newline-delimited JSON-RPC 2.0 client
 * over a child process's stdio. Agent-specific lifecycle and event mapping
 * belong in a session implementation layered on top of this class.
 */
export class AcpStdioClient {
  private readonly pendingRequests = new Map<string, PendingRpcRequest>();
  private child?: ChildProcess;
  private closed = false;
  private fatalError?: Error;
  private messageQueue = Promise.resolve();
  private nextRequestId = 0;
  private stdoutBuffer = '';

  constructor(private readonly options: AcpStdioClientOptions) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  async start(): Promise<void> {
    if (this.child) return;
    if (this.closed) throw new Error('ACP stdio client is closed');

    const spawnPlan = await resolveCliSpawnPlan(this.options.commandPath, this.options.args);
    if (this.closed) throw new Error('ACP stdio client is closed');
    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: this.options.cwd,
      detached: process.platform !== 'win32',
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdin?.once('error', (error) => {
      if (!this.closed) this.fail(error);
    });
    child.stdout?.on('data', (chunk: Buffer) => this.consumeStdout(chunk));
    child.stdout?.once('end', () => this.consumeRemainingStdout());
    child.stdout?.once('error', (error) => this.fail(error));
    child.stderr?.on('data', (chunk: Buffer) => {
      void Promise.resolve()
        .then(() => {
          if (!this.closed) return this.options.onStderr(chunk.toString('utf8'));
        })
        .catch((error) => this.fail(this.toError(error)));
    });
    child.once('error', (error) => this.fail(error));
    child.once('close', (code, signal) => {
      if (this.closed) return;
      const error = new Error(
        `${this.options.processLabel ?? 'ACP process'} exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
      );
      // Node may emit process exit before stdout fully drains. `close` waits
      // for stdio, then this queue wait lets a final structured RPC error win
      // over the less useful process-exit fallback.
      this.messageQueue = this.messageQueue.then(() => this.fail(error));
    });
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs: number | false = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (this.fatalError) throw this.fatalError;
    if (this.closed) throw new Error('ACP stdio client is closed');
    if (!this.child?.stdin) throw new Error('ACP stdio stdin is unavailable');

    const id = ++this.nextRequestId;
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRpcRequest = {
        method,
        reject,
        resolve: (result) => resolve(result as T),
      };
      if (timeoutMs !== false) {
        pending.timeout = setTimeout(() => {
          this.pendingRequests.delete(String(id));
          reject(new Error(`ACP request timed out: ${method}`));
        }, timeoutMs);
        pending.timeout.unref?.();
      }
      this.pendingRequests.set(String(id), pending);
      this.writeRpc({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed || !this.child?.stdin) return;
    this.writeRpc({ method, params });
  }

  async drain(): Promise<void> {
    await this.messageQueue;
    if (this.fatalError) throw this.fatalError;
  }

  close(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.closed) return;
    this.closed = true;
    this.stdoutBuffer = '';
    this.rejectPendingRequests(new Error('ACP stdio client closed by host'));
    this.shutdownProcess(signal);
  }

  private consumeStdout(chunk: Buffer): void {
    if (this.closed) return;
    this.stdoutBuffer += chunk.toString('utf8');

    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.enqueueLine(line);
    }
  }

  private consumeRemainingStdout(): void {
    if (this.closed) {
      this.stdoutBuffer = '';
      return;
    }
    if (!this.stdoutBuffer) return;
    const line = this.stdoutBuffer;
    this.stdoutBuffer = '';
    this.enqueueLine(line);
  }

  private enqueueLine(rawLine: string): void {
    if (this.closed) return;
    const line = rawLine.trim();
    if (!line) return;

    void Promise.resolve()
      .then(() => {
        if (!this.closed) return this.options.onRawMessage(`${line}\n`);
      })
      .catch((error) => this.fail(this.toError(error)));

    let message: AcpRpcMessage;
    try {
      message = JSON.parse(line) as AcpRpcMessage;
    } catch {
      // ACP stdout should be protocol-only, but one diagnostic line must not
      // corrupt the framing of later valid messages.
      return;
    }

    this.messageQueue = this.messageQueue
      .then(() => this.handleMessage(message))
      .catch((error) => this.fail(this.toError(error)));
  }

  private async handleMessage(message: AcpRpcMessage): Promise<void> {
    if (this.closed) return;
    const pending =
      message.method === undefined && message.id !== undefined
        ? this.pendingRequests.get(String(message.id))
        : undefined;
    await this.options.onMessage(
      message.error && pending ? { ...message, requestMethod: pending.method } : message,
    );
    if (this.closed) return;

    if (message.method) {
      if (message.id !== undefined) {
        // Server requests (permissions, questions, plan approval) can block on
        // a host UI. Keep that wait off the serial queue so later
        // `session/update` notifications still reach the adapter.
        void this.handleServerRequest(message).catch((error) => this.fail(this.toError(error)));
      }
      return;
    }

    if (!pending) return;

    this.pendingRequests.delete(String(message.id));
    if (pending.timeout) clearTimeout(pending.timeout);
    if (message.error) pending.reject(new AcpRpcResponseError(pending.method, message.error));
    else pending.resolve(message.result);
  }

  private async handleServerRequest(message: AcpRpcMessage): Promise<void> {
    if (message.id === undefined) return;

    try {
      if (!this.options.onServerRequest) {
        throw new AcpServerRequestError(
          -32_601,
          `Unsupported ACP client request: ${message.method}`,
        );
      }
      const result = await this.options.onServerRequest(message);
      this.writeRpc({ id: message.id, result });
    } catch (error) {
      const responseError =
        error instanceof AcpServerRequestError
          ? { code: error.code, data: error.data, message: error.message }
          : { code: -32_603, message: this.toError(error).message };
      this.writeRpc({ error: responseError, id: message.id });
    }
  }

  private writeRpc(message: Record<string, unknown>): void {
    this.child?.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.fatalError ??= error;
    this.rejectPendingRequests(error);
  }

  private rejectPendingRequests(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private shutdownProcess(signal: NodeJS.Signals): void {
    const child = this.child;
    this.child = undefined;
    if (!child?.pid || child.killed) return;

    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        try {
          child.kill(signal);
        } catch {
          // already gone
        }
      }
      return;
    }

    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // already gone
      }
    }
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}

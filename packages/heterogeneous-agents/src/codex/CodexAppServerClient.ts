import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import { isRecord, pickString } from '@lobechat/utils/object';

import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import type {
  ClientNotification,
  InitializeParams,
  InitializeResponse,
  RequestId,
  ThreadResumeResponse,
} from './protocol';

const APP_SERVER_RPC_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 4000;
const APPROVAL_REQUEST_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
]);

interface PendingRequest {
  method: string;
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ThreadRegistration {
  onResume: (response: ThreadResumeResponse) => Promise<void> | void;
  onResumeError: (error: Error) => Promise<void> | void;
}

type NotificationHandler = (method: string, params: unknown) => Promise<void> | void;
type ServerRequestHandler = (method: string, params: unknown) => Promise<unknown> | unknown;
type TextHandler = (data: string) => Promise<void> | void;

export interface CodexAppServerClientOptions {
  args?: string[];
  clientVersion: string;
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
}

export class CodexAppServerRpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
    readonly method?: string,
  ) {
    super(message);
    this.name = 'CodexAppServerRpcError';
  }
}

export class CodexAppServerConnectionError extends Error {
  readonly phase?: 'initialize';

  constructor(message: string, options?: ErrorOptions & { phase?: 'initialize' }) {
    super(message, options);
    this.name = 'CodexAppServerConnectionError';
    this.phase = options?.phase;
  }
}

export const isCodexAppServerCompatibilityError = (error: unknown): boolean =>
  (error instanceof CodexAppServerConnectionError && error.phase === 'initialize') ||
  (error instanceof CodexAppServerRpcError &&
    (error.method === 'initialize' || error.code === -32_601));

/**
 * One long-lived, bidirectional NDJSON client for `codex app-server`.
 *
 * stdout has exactly one reader here. It correlates RPC responses, publishes
 * notifications to the owning thread session, and separately routes
 * server-initiated requests back to that thread.
 */
export class CodexAppServerClient {
  private child?: ChildProcess;
  private closedByHost = false;
  private connectPromise?: Promise<InitializeResponse>;
  private connectionError?: Error;
  private connected = false;
  private hasConnected = false;
  private nextRequestId = 0;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<NotificationHandler>>();
  private readonly serverRequestHandlers = new Map<string, Set<ServerRequestHandler>>();
  private readonly disconnectHandlers = new Set<(error: Error) => void>();
  private readonly rawMessageHandlers = new Set<TextHandler>();
  private readonly stderrHandlers = new Set<TextHandler>();
  private readonly threadRegistrations = new Map<string, Set<ThreadRegistration>>();
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stdoutBuffer = '';

  constructor(private readonly options: CodexAppServerClientOptions) {}

  get isConnected(): boolean {
    return this.connected && !this.connectionError;
  }

  /** Process-global options must stay identical while this long-lived client is reused. */
  canReuseFor(options: Pick<CodexAppServerClientOptions, 'args' | 'commandPath' | 'env'>): boolean {
    const currentArgs = this.options.args ?? [];
    const nextArgs = options.args ?? [];
    if (
      this.options.commandPath !== options.commandPath ||
      currentArgs.length !== nextArgs.length ||
      currentArgs.some((arg, index) => arg !== nextArgs[index])
    ) {
      return false;
    }

    const currentEnv = Object.entries(this.options.env).filter(([, value]) => value !== undefined);
    const nextEnv = Object.entries(options.env).filter(([, value]) => value !== undefined);
    return (
      currentEnv.length === nextEnv.length &&
      currentEnv.every(([key, value]) => options.env[key] === value)
    );
  }

  connect(): Promise<InitializeResponse> {
    if (this.closedByHost) {
      return Promise.reject(
        new CodexAppServerConnectionError('Codex app-server client closed by host'),
      );
    }
    if (!this.connectPromise) this.connectPromise = this.initialize();
    return this.connectPromise;
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.connected && method !== 'initialize') await this.connect();
    if (this.connectionError) throw this.connectionError;
    if (!this.child?.stdin) {
      throw new CodexAppServerConnectionError('Codex app-server stdin is unavailable');
    }

    const id = ++this.nextRequestId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(String(id));
        const error = new CodexAppServerConnectionError(
          `Codex app-server request timed out: ${method}`,
        );
        reject(error);
        this.fail(error);
      }, APP_SERVER_RPC_TIMEOUT_MS);
      timeout.unref?.();
      this.pendingRequests.set(String(id), {
        method,
        reject,
        resolve: (result) => resolve(result as T),
        timeout,
      });
      this.write({ id, method, params });
    });
  }

  notify(notification: ClientNotification): void {
    this.write({ ...notification });
  }

  subscribe(threadId: string, handler: NotificationHandler): () => void {
    const handlers = this.notificationHandlers.get(threadId) ?? new Set();
    handlers.add(handler);
    this.notificationHandlers.set(threadId, handlers);
    return () => this.removeHandler(this.notificationHandlers, threadId, handler);
  }

  subscribeServerRequests(threadId: string, handler: ServerRequestHandler): () => void {
    const handlers = this.serverRequestHandlers.get(threadId) ?? new Set();
    handlers.add(handler);
    this.serverRequestHandlers.set(threadId, handlers);
    return () => this.removeHandler(this.serverRequestHandlers, threadId, handler);
  }

  registerThread(threadId: string, registration: ThreadRegistration): () => void {
    const registrations = this.threadRegistrations.get(threadId) ?? new Set();
    registrations.add(registration);
    this.threadRegistrations.set(threadId, registrations);

    if (!this.connected && this.connectionError) this.scheduleReconnect();
    return () => {
      registrations.delete(registration);
      if (registrations.size === 0) this.threadRegistrations.delete(threadId);
      if (this.threadRegistrations.size === 0 && this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
    };
  }

  onDisconnect(handler: (error: Error) => void): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  onRawMessage(handler: TextHandler): () => void {
    this.rawMessageHandlers.add(handler);
    return () => this.rawMessageHandlers.delete(handler);
  }

  onStderr(handler: TextHandler): () => void {
    this.stderrHandlers.add(handler);
    return () => this.stderrHandlers.delete(handler);
  }

  close(): void {
    if (this.closedByHost) return;
    this.closedByHost = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const error = new CodexAppServerConnectionError('Codex app-server client closed by host');
    this.fail(error, false);
    const child = this.child;
    this.child = undefined;
    this.terminateChild(child);
  }

  private async initialize(): Promise<InitializeResponse> {
    const isReconnect = this.hasConnected;
    this.connectionError = undefined;
    try {
      await this.startProcess();
      const params: InitializeParams = {
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
        clientInfo: {
          name: 'lobehub-desktop',
          title: 'LobeHub Desktop',
          version: this.options.clientVersion,
        },
      };
      const response = await this.request<InitializeResponse>('initialize', params);
      this.notify({ method: 'initialized' });
      this.connected = true;
      this.hasConnected = true;
      if (isReconnect) {
        await this.resumeRegisteredThreads();
        if (!this.connected || this.connectionError) {
          throw (
            this.connectionError ??
            new CodexAppServerConnectionError(
              'Codex app-server disconnected while resuming threads',
            )
          );
        }
      }
      this.reconnectAttempt = 0;
      return response;
    } catch (error) {
      const failure =
        error instanceof CodexAppServerRpcError || error instanceof CodexAppServerConnectionError
          ? error
          : new CodexAppServerConnectionError('Codex app-server handshake failed', {
              cause: error,
            });
      const connectionError =
        !isReconnect && failure instanceof CodexAppServerConnectionError
          ? new CodexAppServerConnectionError(failure.message, {
              cause: failure,
              phase: 'initialize',
            })
          : failure;
      this.fail(connectionError);
      throw connectionError;
    }
  }

  private async startProcess(): Promise<void> {
    const spawnPlan = await resolveCliSpawnPlan(this.options.commandPath, [
      ...(this.options.args ?? []),
      'app-server',
    ]);
    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: this.options.cwd,
      detached: process.platform !== 'win32',
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdin?.on('error', () => {
      // The process error/exit listener owns the actionable failure. Ignore a racing EPIPE.
    });
    child.stdout?.on('data', (chunk: Buffer) => this.consumeStdout(chunk));
    child.stderr?.on('data', (chunk: Buffer) =>
      this.emitText(this.stderrHandlers, chunk.toString()),
    );
    child.once('error', (error) => {
      if (this.child !== child) return;
      this.fail(
        new CodexAppServerConnectionError(`Failed to start Codex app-server: ${error.message}`, {
          cause: error,
        }),
      );
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.fail(
        new CodexAppServerConnectionError(
          `Codex app-server exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
        ),
      );
    });
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf8');
    let newlineIndex: number;

    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;

      this.emitText(this.rawMessageHandlers, `${line}\n`);
      try {
        this.routeMessage(JSON.parse(line));
      } catch (error) {
        this.fail(
          new CodexAppServerConnectionError('Codex app-server emitted invalid NDJSON', {
            cause: error,
          }),
        );
      }
    }
  }

  private routeMessage(message: unknown): void {
    if (!isRecord(message)) throw new TypeError('Expected an app-server RPC object');
    const method = pickString(message.method);
    const id = message.id as RequestId | undefined;

    if (method) {
      if (id !== undefined) {
        void this.routeServerRequest(id, method, message.params);
      } else {
        this.routeNotification(method, message.params);
      }
      return;
    }

    if (id === undefined) return;
    const pending = this.pendingRequests.get(String(id));
    if (!pending) return;

    this.pendingRequests.delete(String(id));
    clearTimeout(pending.timeout);
    if (isRecord(message.error)) {
      pending.reject(
        new CodexAppServerRpcError(
          pickString(message.error.message) ?? `Codex app-server request failed: ${pending.method}`,
          typeof message.error.code === 'number' ? message.error.code : undefined,
          message.error.data,
          pending.method,
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private routeNotification(method: string, params: unknown): void {
    const threadId = isRecord(params) ? pickString(params.threadId) : undefined;
    if (!threadId) return;
    for (const handler of this.notificationHandlers.get(threadId) ?? []) {
      void handler(method, params);
    }
  }

  private async routeServerRequest(id: RequestId, method: string, params: unknown): Promise<void> {
    const threadId = isRecord(params) ? pickString(params.threadId) : undefined;
    const handlers = threadId ? this.serverRequestHandlers.get(threadId) : undefined;
    const handler = handlers?.values().next().value as ServerRequestHandler | undefined;

    try {
      if (handler) {
        this.write({ id, result: await handler(method, params) });
      } else if (APPROVAL_REQUEST_METHODS.has(method)) {
        this.write({ id, result: { decision: 'cancel' } });
      } else {
        this.write({
          error: { code: -32_601, message: `Unsupported Codex app-server request: ${method}` },
          id,
        });
      }
    } catch (error) {
      this.write({
        error: {
          code: -32_603,
          message: error instanceof Error ? error.message : 'Codex server request failed',
        },
        id,
      });
    }
  }

  private write(message: Record<string, unknown>): void {
    if (!this.child?.stdin) {
      throw new CodexAppServerConnectionError('Codex app-server stdin is unavailable');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private emitText(handlers: Set<TextHandler>, data: string): void {
    for (const handler of handlers) void handler(data);
  }

  private removeHandler<T>(map: Map<string, Set<T>>, key: string, handler: T): void {
    const handlers = map.get(key);
    handlers?.delete(handler);
    if (handlers?.size === 0) map.delete(key);
  }

  private fail(error: Error, reconnect = true): void {
    if (this.connectionError) return;
    this.connectionError = error;
    this.connected = false;
    this.connectPromise = undefined;
    this.stdoutBuffer = '';
    const child = this.child;
    this.child = undefined;
    this.terminateChild(child);
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    for (const handler of this.disconnectHandlers) handler(error);
    if (reconnect) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closedByHost || this.reconnectTimer || this.threadRegistrations.size === 0) {
      return;
    }

    const baseDelay = this.options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelay = this.options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const delay = Math.min(baseDelay * 2 ** this.reconnectAttempt, maxDelay);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => {
        // initialize() records the failure and schedules the next backoff attempt.
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async resumeRegisteredThreads(): Promise<void> {
    await Promise.all(
      [...this.threadRegistrations].map(async ([threadId, registrations]) => {
        try {
          const response = await this.request<ThreadResumeResponse>('thread/resume', { threadId });
          await Promise.all([...registrations].map(({ onResume }) => onResume(response)));
        } catch (error) {
          // A second transport failure schedules another reconnect attempt; keep
          // sessions waiting instead of treating the thread itself as invalid.
          if (!this.connected) return;
          const resumeError = error instanceof Error ? error : new Error(String(error));
          await Promise.all(
            [...registrations].map(({ onResumeError }) => onResumeError(resumeError)),
          );
        }
      }),
    );
  }

  private terminateChild(child?: ChildProcess): void {
    if (!child?.pid || child.killed) return;

    if (process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGTERM');
        return;
      } catch {
        // Fall through to a direct signal when the process group is already gone.
      }
    }
    child.kill('SIGTERM');
  }
}

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { isRecord, pickString } from '@lobechat/utils/object';

import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import type {
  ClientNotification,
  InitializeParams,
  InitializeResponse,
  RequestId,
  ThreadResumeParams,
  ThreadResumeResponse,
} from './protocol';

const APP_SERVER_RPC_TIMEOUT_MS = 30_000;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 4000;
const DEFAULT_RECONNECT_MAX_ATTEMPTS = 5;
const APPROVAL_REQUEST_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
]);

interface PendingRequest {
  generation: number;
  method: string;
  reject: (error: Error) => void;
  resolve: (result: unknown) => void;
  threadId?: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface ThreadRegistration {
  onResume: (response: ThreadResumeResponse) => Promise<void> | void;
  onResumeError: (error: Error) => Promise<void> | void;
}

interface ThreadRegistrationGroup {
  params: ThreadResumeParams;
  registrations: Set<ThreadRegistration>;
}

interface ProcessGeneration {
  child: ChildProcess;
  generation: number;
  stdoutBuffer: string;
}

interface ConnectionState {
  generation: number;
  promise: Promise<InitializeResponse>;
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
  reconnectMaxAttempts?: number;
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
  readonly phase?: 'initialize' | 'thread-start';

  constructor(message: string, options?: ErrorOptions & { phase?: 'initialize' | 'thread-start' }) {
    super(message, options);
    this.name = 'CodexAppServerConnectionError';
    this.phase = options?.phase;
  }
}

export const isCodexAppServerCompatibilityError = (error: unknown): boolean =>
  (error instanceof CodexAppServerConnectionError &&
    (error.phase === 'initialize' || error.phase === 'thread-start')) ||
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
  private activeGeneration = 0;
  private closedByHost = false;
  private connectionState?: ConnectionState;
  private connectionError?: Error;
  private connected = false;
  private consumerCount = 0;
  private generationSequence = 0;
  private hasConnected = false;
  private nextRequestId = 0;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly notificationHandlers = new Map<string, Set<NotificationHandler>>();
  private readonly serverRequestHandlers = new Map<string, Set<ServerRequestHandler>>();
  private readonly disconnectHandlers = new Set<(error: Error) => void>();
  private readonly rawMessageHandlers = new Map<string, Set<TextHandler>>();
  private readonly stderrHandlers = new Set<TextHandler>();
  private readonly threadRegistrations = new Map<string, ThreadRegistrationGroup>();
  private processGeneration?: ProcessGeneration;
  private reconnectAttempt = 0;
  private reconnectEpoch = 0;
  private reconnectExhaustedEpoch?: number;
  private reconnectTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: CodexAppServerClientOptions) {}

  get isConnected(): boolean {
    return this.connected && !this.connectionError;
  }

  get hasConsumers(): boolean {
    return this.consumerCount > 0;
  }

  acquireConsumer(): () => void {
    if (this.closedByHost) {
      throw new CodexAppServerConnectionError('Codex app-server client closed by host');
    }
    this.consumerCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.consumerCount -= 1;
    };
  }

  /** Process-global options must stay identical while this long-lived client is reused. */
  canReuseFor(
    options: Pick<CodexAppServerClientOptions, 'args' | 'commandPath' | 'cwd' | 'env'>,
  ): boolean {
    const currentArgs = this.options.args ?? [];
    const nextArgs = options.args ?? [];
    const commandIsRelativePath =
      !path.isAbsolute(this.options.commandPath) &&
      (this.options.commandPath.includes('/') || this.options.commandPath.includes('\\'));
    if (
      this.options.commandPath !== options.commandPath ||
      (commandIsRelativePath && this.options.cwd !== options.cwd) ||
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
    if (this.connectionState && !this.connectionError) return this.connectionState.promise;
    this.startUserRecoveryEpoch();
    return this.startConnection();
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    if (!this.connected) await this.connect();
    if (this.connectionError) throw this.connectionError;
    return this.requestForGeneration<T>(this.activeGeneration, method, params);
  }

  notify(notification: ClientNotification): void {
    this.writeForGeneration(this.activeGeneration, { ...notification });
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

  registerThread(
    threadId: string,
    params: ThreadResumeParams,
    registration: ThreadRegistration,
  ): () => void {
    if (params.threadId !== threadId) {
      throw new Error(`Codex resume params do not match registered thread: ${threadId}`);
    }
    const existing = this.threadRegistrations.get(threadId);
    if (existing && JSON.stringify(existing.params) !== JSON.stringify(params)) {
      throw new Error(`Conflicting Codex resume params for thread: ${threadId}`);
    }
    const group = existing ?? { params, registrations: new Set() };
    group.registrations.add(registration);
    this.threadRegistrations.set(threadId, group);

    if (!this.connected && this.connectionError) this.scheduleReconnect();
    return () => {
      group.registrations.delete(registration);
      if (group.registrations.size === 0) this.threadRegistrations.delete(threadId);
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

  onRawMessage(threadId: string, handler: TextHandler): () => void {
    const handlers = this.rawMessageHandlers.get(threadId) ?? new Set();
    handlers.add(handler);
    this.rawMessageHandlers.set(threadId, handlers);
    return () => this.removeHandler(this.rawMessageHandlers, threadId, handler);
  }

  onStderr(handler: TextHandler): () => void {
    this.stderrHandlers.add(handler);
    return () => this.stderrHandlers.delete(handler);
  }

  close(): void {
    if (this.closedByHost) return;
    this.closedByHost = true;
    this.reconnectEpoch += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const error = new CodexAppServerConnectionError('Codex app-server client closed by host');
    const generation = this.activeGeneration;
    this.activeGeneration = ++this.generationSequence;
    this.connected = false;
    this.connectionError = error;
    this.connectionState = undefined;
    const processGeneration = this.processGeneration;
    this.processGeneration = undefined;
    this.rejectPendingRequests(generation, error);
    this.emitDisconnect(error);
    this.terminateChild(processGeneration?.child);
  }

  private startConnection(): Promise<InitializeResponse> {
    if (this.closedByHost) {
      return Promise.reject(
        new CodexAppServerConnectionError('Codex app-server client closed by host'),
      );
    }
    const generation = ++this.generationSequence;
    const isReconnect = this.hasConnected;
    this.activeGeneration = generation;
    this.connected = false;
    this.connectionError = undefined;
    const promise = this.initialize(generation, isReconnect);
    this.connectionState = { generation, promise };
    return promise;
  }

  private async initialize(generation: number, isReconnect: boolean): Promise<InitializeResponse> {
    try {
      await this.startProcess(generation);
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
      const response = await this.requestForGeneration<InitializeResponse>(
        generation,
        'initialize',
        params,
      );
      this.writeForGeneration(generation, { method: 'initialized' });
      if (!this.isCurrentGeneration(generation)) {
        throw new CodexAppServerConnectionError('Codex app-server connection was replaced');
      }
      this.connected = true;
      this.hasConnected = true;
      if (isReconnect) {
        await this.resumeRegisteredThreads(generation);
        if (!this.isCurrentGeneration(generation) || !this.connected || this.connectionError) {
          throw (
            this.connectionError ??
            new CodexAppServerConnectionError(
              'Codex app-server disconnected while resuming threads',
            )
          );
        }
      }
      this.reconnectAttempt = 0;
      this.reconnectExhaustedEpoch = undefined;
      return response;
    } catch (error) {
      const failure = this.toConnectionError(error, 'Codex app-server handshake failed');
      if (!this.isCurrentGeneration(generation)) throw failure;
      const connectionError =
        !isReconnect && failure instanceof CodexAppServerConnectionError
          ? new CodexAppServerConnectionError(failure.message, {
              cause: failure,
              phase: 'initialize',
            })
          : failure;
      this.fail(connectionError, generation);
      throw connectionError;
    }
  }

  private async startProcess(generation: number): Promise<void> {
    const spawnPlan = await resolveCliSpawnPlan(this.options.commandPath, [
      ...(this.options.args ?? []),
      'app-server',
    ]);
    if (!this.isCurrentGeneration(generation)) {
      throw new CodexAppServerConnectionError(
        this.closedByHost
          ? 'Codex app-server client closed by host'
          : 'Codex app-server connection was replaced',
      );
    }

    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: this.options.cwd,
      detached: process.platform !== 'win32',
      env: this.options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const processGeneration = { child, generation, stdoutBuffer: '' };
    if (!this.isCurrentGeneration(generation)) {
      this.terminateChild(child);
      throw new CodexAppServerConnectionError('Codex app-server connection was replaced');
    }
    this.processGeneration = processGeneration;
    child.stdin?.on('error', () => {
      // The process error/exit listener owns the actionable failure. Ignore a racing EPIPE.
    });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (!this.ownsProcess(processGeneration)) return;
      this.consumeStdout(processGeneration, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!this.ownsProcess(processGeneration)) return;
      this.emitText(this.stderrHandlers, chunk.toString());
    });
    child.once('error', (error) => {
      if (!this.ownsProcess(processGeneration)) return;
      this.fail(
        new CodexAppServerConnectionError(`Failed to start Codex app-server: ${error.message}`, {
          cause: error,
        }),
        generation,
      );
    });
    child.once('exit', (code, signal) => {
      if (!this.ownsProcess(processGeneration)) return;
      this.fail(
        new CodexAppServerConnectionError(
          `Codex app-server exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`,
        ),
        generation,
      );
    });
  }

  private requestForGeneration<T>(
    generation: number,
    method: string,
    params?: unknown,
  ): Promise<T> {
    const processGeneration = this.processGeneration;
    if (
      !processGeneration ||
      !this.ownsProcess(processGeneration) ||
      generation !== this.activeGeneration
    ) {
      return Promise.reject(
        new CodexAppServerConnectionError('Codex app-server stdin is unavailable'),
      );
    }

    const id = ++this.nextRequestId;
    const key = String(id);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const current = this.pendingRequests.get(key);
        if (!current || current.generation !== generation) return;
        this.pendingRequests.delete(key);
        const error = new CodexAppServerConnectionError(
          `Codex app-server request timed out: ${method}`,
        );
        reject(error);
        this.fail(error, generation);
      }, APP_SERVER_RPC_TIMEOUT_MS);
      timeout.unref?.();
      const pending: PendingRequest = {
        generation,
        method,
        reject,
        resolve: (result) => resolve(result as T),
        threadId: isRecord(params) ? pickString(params.threadId) : undefined,
        timeout,
      };
      this.pendingRequests.set(key, pending);
      try {
        this.writeToProcess(processGeneration, { id, method, params });
      } catch (error) {
        if (this.pendingRequests.get(key) === pending) this.pendingRequests.delete(key);
        clearTimeout(timeout);
        const connectionError = this.toConnectionError(
          error,
          `Failed to write Codex app-server request: ${method}`,
        );
        reject(connectionError);
        this.fail(connectionError, generation);
      }
    });
  }

  private consumeStdout(processGeneration: ProcessGeneration, chunk: Buffer): void {
    processGeneration.stdoutBuffer += chunk.toString('utf8');
    let newlineIndex: number;

    while ((newlineIndex = processGeneration.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = processGeneration.stdoutBuffer.slice(0, newlineIndex).trim();
      processGeneration.stdoutBuffer = processGeneration.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;

      try {
        const message = JSON.parse(line);
        const threadId = this.getMessageThreadId(processGeneration.generation, message);
        const rawHandlers = threadId ? this.rawMessageHandlers.get(threadId) : undefined;
        if (rawHandlers) this.emitText(rawHandlers, `${line}\n`);
        this.routeMessage(processGeneration.generation, message);
      } catch (error) {
        this.fail(
          new CodexAppServerConnectionError('Codex app-server emitted invalid NDJSON', {
            cause: error,
          }),
          processGeneration.generation,
        );
        return;
      }
    }
  }

  private getMessageThreadId(generation: number, message: unknown): string | undefined {
    if (!isRecord(message)) return;
    if (isRecord(message.params)) {
      const threadId = pickString(message.params.threadId);
      if (threadId) return threadId;
    }

    const id = message.id as RequestId | undefined;
    if (id === undefined) return;
    const pending = this.pendingRequests.get(String(id));
    return pending?.generation === generation ? pending.threadId : undefined;
  }

  private routeMessage(generation: number, message: unknown): void {
    if (!this.isCurrentGeneration(generation)) return;
    if (!isRecord(message)) throw new TypeError('Expected an app-server RPC object');
    const method = pickString(message.method);
    const id = message.id as RequestId | undefined;

    if (method) {
      if (id !== undefined) {
        void this.routeServerRequest(generation, id, method, message.params);
      } else {
        this.routeNotification(method, message.params);
      }
      return;
    }

    if (id === undefined) return;
    const key = String(id);
    const pending = this.pendingRequests.get(key);
    if (!pending || pending.generation !== generation) return;

    this.pendingRequests.delete(key);
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

  private async routeServerRequest(
    generation: number,
    id: RequestId,
    method: string,
    params: unknown,
  ): Promise<void> {
    const threadId = isRecord(params) ? pickString(params.threadId) : undefined;
    const handlers = threadId ? this.serverRequestHandlers.get(threadId) : undefined;
    const handler = handlers?.values().next().value as ServerRequestHandler | undefined;
    let response: Record<string, unknown>;

    try {
      if (handler) {
        response = { id, result: await handler(method, params) };
      } else if (APPROVAL_REQUEST_METHODS.has(method)) {
        response = { id, result: { decision: 'cancel' } };
      } else {
        response = {
          error: { code: -32_601, message: `Unsupported Codex app-server request: ${method}` },
          id,
        };
      }
    } catch (error) {
      response = {
        error: {
          code: -32_603,
          message: error instanceof Error ? error.message : 'Codex server request failed',
        },
        id,
      };
    }

    if (!this.isCurrentGeneration(generation)) return;
    try {
      this.writeForGeneration(generation, response);
    } catch (error) {
      this.fail(
        this.toConnectionError(error, 'Failed to write Codex app-server response'),
        generation,
      );
    }
  }

  private writeForGeneration(generation: number, message: Record<string, unknown>): void {
    const processGeneration = this.processGeneration;
    if (!processGeneration || processGeneration.generation !== generation) {
      throw new CodexAppServerConnectionError('Codex app-server stdin is unavailable');
    }
    this.writeToProcess(processGeneration, message);
  }

  private writeToProcess(
    processGeneration: ProcessGeneration,
    message: Record<string, unknown>,
  ): void {
    if (!this.ownsProcess(processGeneration) || !processGeneration.child.stdin) {
      throw new CodexAppServerConnectionError('Codex app-server stdin is unavailable');
    }
    processGeneration.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private emitText(handlers: Set<TextHandler>, data: string): void {
    for (const handler of handlers) void handler(data);
  }

  private removeHandler<T>(map: Map<string, Set<T>>, key: string, handler: T): void {
    const handlers = map.get(key);
    handlers?.delete(handler);
    if (handlers?.size === 0) map.delete(key);
  }

  private fail(error: Error, generation: number, reconnect = true): void {
    if (!this.isCurrentGeneration(generation) || this.connectionError) return;
    this.connectionError = error;
    this.connected = false;
    if (this.connectionState?.generation === generation) this.connectionState = undefined;
    const processGeneration = this.processGeneration;
    if (processGeneration?.generation === generation) {
      this.processGeneration = undefined;
      this.terminateChild(processGeneration.child);
    }
    this.rejectPendingRequests(generation, error);
    this.emitDisconnect(error);
    if (reconnect) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closedByHost || this.reconnectTimer || this.threadRegistrations.size === 0) {
      return;
    }

    const maxAttempts = Math.max(
      0,
      Math.floor(this.options.reconnectMaxAttempts ?? DEFAULT_RECONNECT_MAX_ATTEMPTS),
    );
    const epoch = this.reconnectEpoch;
    if (this.reconnectAttempt >= maxAttempts) {
      if (this.reconnectExhaustedEpoch === epoch) return;
      this.reconnectExhaustedEpoch = epoch;
      const error = new CodexAppServerConnectionError(
        `Codex app-server reconnect exhausted after ${maxAttempts} attempts`,
      );
      this.notifyResumeErrors(error);
      return;
    }

    const baseDelay = this.options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS;
    const maxDelay = this.options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    const delay = Math.min(baseDelay * 2 ** this.reconnectAttempt, maxDelay);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (epoch !== this.reconnectEpoch || this.closedByHost) return;
      void this.startConnection().catch(() => {
        // initialize() records the failure and schedules the next backoff attempt.
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async resumeRegisteredThreads(generation: number): Promise<void> {
    await Promise.all(
      [...this.threadRegistrations.values()].map(async ({ params, registrations }) => {
        try {
          const response = await this.requestForGeneration<ThreadResumeResponse>(
            generation,
            'thread/resume',
            params,
          );
          if (!this.isCurrentGeneration(generation) || !this.connected) return;
          await Promise.allSettled([...registrations].map(({ onResume }) => onResume(response)));
        } catch (error) {
          // A second transport failure schedules another reconnect attempt; keep
          // sessions waiting instead of treating the thread itself as invalid.
          if (!this.isCurrentGeneration(generation) || !this.connected) return;
          const resumeError = error instanceof Error ? error : new Error(String(error));
          await Promise.allSettled(
            [...registrations].map(({ onResumeError }) => onResumeError(resumeError)),
          );
        }
      }),
    );
  }

  private startUserRecoveryEpoch(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.reconnectAttempt = 0;
    this.reconnectEpoch += 1;
    this.reconnectExhaustedEpoch = undefined;
  }

  private notifyResumeErrors(error: Error): void {
    void Promise.allSettled(
      [...this.threadRegistrations.values()].flatMap(({ registrations }) =>
        [...registrations].map(({ onResumeError }) => onResumeError(error)),
      ),
    );
  }

  private rejectPendingRequests(generation: number, error: Error): void {
    for (const [key, pending] of this.pendingRequests) {
      if (pending.generation !== generation) continue;
      this.pendingRequests.delete(key);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  private emitDisconnect(error: Error): void {
    for (const handler of this.disconnectHandlers) {
      try {
        handler(error);
      } catch (handlerError) {
        console.error('Codex app-server disconnect handler failed:', handlerError);
      }
    }
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.closedByHost && this.activeGeneration === generation;
  }

  private ownsProcess(processGeneration: ProcessGeneration): boolean {
    return (
      this.isCurrentGeneration(processGeneration.generation) &&
      this.processGeneration === processGeneration
    );
  }

  private toConnectionError(error: unknown, message: string): Error {
    if (error instanceof CodexAppServerRpcError || error instanceof CodexAppServerConnectionError) {
      return error;
    }
    return new CodexAppServerConnectionError(message, { cause: error });
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
